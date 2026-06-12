import { createServerFn } from '@tanstack/react-start'

import { validateInvoiceUpload } from '@/features/invoices/intake-file-validation'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
import {
  getInvoiceReadinessSummary,
  isInvoiceJobDeletable,
  parseCurrencyAmount,
  parseOptionalCurrencyAmount,
  roundCurrency,
  type InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  buildInvoiceProviderInput,
  calculateDraftConfidence,
  INVOICE_EXTRACTION_SCHEMA_VERSION,
  getExtractionResultId,
  mapIntakeStageToInvoiceStatus,
  parseStoredExtractionDraft,
  persistAdditionalInvoiceExtractionDrafts,
  selectInvoiceExtractionProvider,
  serializeExtractionDraft,
  type InvoiceExtractionDraft,
} from '@/lib/server/extraction'
import { uploadInvoiceSourceDocument } from '@/lib/server/upload'

interface LatestExtractionRow {
  id: string
  structuredJson: string | null
  markdownText: string | null
}

interface IntakeSourceRow {
  sourceDocumentId: string
}

interface RecheckSourceRow {
  jobId: string
  stage: string
  sourceDocumentId: string
  r2Key: string | null
  fileName: string
  mimeType: string | null
  uploadedAt: string
}

interface InvoiceIdRow {
  id: string
}

interface IntakeStageRow {
  stage: string
}

interface DeletableIntakeJobRow {
  jobId: string
  stage: string
  sourceDocumentId: string
  r2Key: string | null
}

interface RecheckSiblingRow {
  jobId: string
  stage: string
}

export const uploadInvoiceIntakeDocument = createServerFn({ method: 'POST' })
  .inputValidator((data) => {
    if (!(data instanceof FormData)) {
      throw new Error('Expected FormData')
    }

    return data
  })
  .handler(async ({ data, context }) => {
    const file = data.get('file')
    if (!(file instanceof File)) {
      throw new Error('Expected a file field named "file"')
    }

    const validationResult = validateInvoiceUpload(file)
    if (!validationResult.isValid) {
      throw new Error(validationResult.errorMessage ?? '文件校验失败。')
    }

    const uploadedBy = data.get('uploadedBy')?.toString() ?? null
    const env = getServerEnv(context)

    return uploadInvoiceSourceDocument({
      env: env ?? {},
      file,
      uploadedBy,
    })
  })

export const deleteInvoiceIntakeJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { jobId: string }) => {
    if (!data.jobId.trim()) {
      throw new Error('Expected invoice intake job id')
    }

    return { jobId: data.jobId.trim() }
  })
  .handler(async ({ data, context }) =>
    deleteInvoiceIntakeJobFromDatabase(getServerEnv(context), data.jobId),
  )

export const saveInvoiceReviewJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { job: InvoiceReviewJob }) => data)
  .handler(async ({ data, context }) =>
    persistInvoiceReviewDraft(getServerEnv(context), data.job, 'needs_review'),
  )

export const confirmInvoiceReviewJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { job: InvoiceReviewJob }) => data)
  .handler(async ({ data, context }) =>
    confirmInvoiceReviewJobInDatabase(getServerEnv(context), data.job),
  )

export const recheckInvoiceReviewJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { jobId: string }) => {
    if (!data.jobId.trim()) {
      throw new Error('Expected invoice review job id')
    }

    return { jobId: data.jobId.trim() }
  })
  .handler(async ({ data, context }) =>
    recheckInvoiceReviewJobInDatabase(getServerEnv(context), data.jobId),
  )

export async function confirmInvoiceReviewJobInDatabase(
  env: Partial<AppBindings> | null | undefined,
  job: InvoiceReviewJob,
) {
  const readinessSummary = getInvoiceReadinessSummary(job)

  if (!readinessSummary.isReady) {
    const savedJob = await persistInvoiceReviewDraft(env, job, 'needs_review')

    return {
      ok: false,
      job: savedJob,
      readinessSummary,
    }
  }

  const savedJob = await persistInvoiceReviewDraft(env, job, 'ready')
  await writeConfirmedInvoiceAccounting(env, savedJob)

  return {
    ok: true,
    job: savedJob,
    readinessSummary,
  }
}

export async function deleteInvoiceIntakeJobFromDatabase(
  env: Partial<AppBindings> | null | undefined,
  jobId: string,
) {
  const db = requireD1Database(env, 'invoice intake delete')
  const [row] = await allD1<DeletableIntakeJobRow>(
    db,
    `/* invoice:delete-intake-load */
    SELECT
      intake_jobs.id AS jobId,
      intake_jobs.stage AS stage,
      source_documents.id AS sourceDocumentId,
      source_documents.r2_key AS r2Key
    FROM intake_jobs
    INNER JOIN source_documents
      ON source_documents.id = intake_jobs.source_document_id
    WHERE intake_jobs.id = ?
    LIMIT 1`,
    [jobId],
  )

  if (!row) {
    return {
      ok: true,
      deleted: false,
    }
  }

  if (
    !isInvoiceJobDeletable({
      stage: row.stage as InvoiceReviewJob['stage'],
      status: row.stage === 'ready' ? 'ready' : 'needs_review',
    })
  ) {
    throw new Error('已完成的发票任务不能从最近任务中删除。')
  }

  const rawDocumentsBucket = env?.RAW_DOCUMENTS

  if (row.r2Key && !rawDocumentsBucket) {
    throw new Error('Missing Cloudflare binding: RAW_DOCUMENTS')
  }

  const claimResult = await db
    .prepare(
      `/* invoice:delete-intake-claim */
      UPDATE intake_jobs
      SET stage = 'deleting'
      WHERE id = ? AND stage != 'ready'`,
    )
    .bind(row.jobId)
    .run()

  if ((claimResult.meta?.changes ?? 0) === 0) {
    throw new Error('已完成的发票任务不能从最近任务中删除。')
  }

  await db
    .prepare(
      `/* invoice:delete-extractions */
      DELETE FROM extraction_results
      WHERE intake_job_id = ?`,
    )
    .bind(row.jobId)
    .run()

  const intakeDeleteResult = await db
    .prepare(
      `/* invoice:delete-intake-job */
      DELETE FROM intake_jobs
      WHERE id = ? AND stage = 'deleting'`,
    )
    .bind(row.jobId)
    .run()

  if ((intakeDeleteResult.meta?.changes ?? 0) !== 1) {
    throw new Error('发票任务删除状态已变化，不能完成删除。')
  }

  const [{ referenceCount } = { referenceCount: 0 }] = await allD1<{
    referenceCount: number
  }>(
    db,
    `/* invoice:delete-source-reference-count */
    SELECT COUNT(*) AS referenceCount
    FROM intake_jobs
    WHERE source_document_id = ?`,
    [row.sourceDocumentId],
  )
  const isLastSourceJob = Number(referenceCount) === 0

  if (row.r2Key && isLastSourceJob) {
    const documentsBucket = rawDocumentsBucket

    if (!documentsBucket) {
      throw new Error('Missing Cloudflare binding: RAW_DOCUMENTS')
    }

    await documentsBucket.delete(row.r2Key)
  }

  if (isLastSourceJob) {
    await db
      .prepare(
        `/* invoice:delete-source-document */
        DELETE FROM source_documents
        WHERE id = ?`,
      )
      .bind(row.sourceDocumentId)
      .run()
  }

  return {
    ok: true,
    deleted: true,
  }
}

export async function recheckInvoiceReviewJobInDatabase(
  env: Partial<AppBindings> | null | undefined,
  jobId: string,
) {
  const db = requireD1Database(env, 'invoice review recheck')
  const rawDocumentsBucket = env?.RAW_DOCUMENTS

  if (!rawDocumentsBucket) {
    throw new Error('Missing Cloudflare binding: RAW_DOCUMENTS')
  }

  const [row] = await allD1<RecheckSourceRow>(
    db,
    `/* invoice:recheck-source */
    SELECT
      intake_jobs.id AS jobId,
      intake_jobs.stage AS stage,
      source_documents.id AS sourceDocumentId,
      source_documents.r2_key AS r2Key,
      source_documents.original_filename AS fileName,
      source_documents.mime_type AS mimeType,
      source_documents.uploaded_at AS uploadedAt
    FROM intake_jobs
    INNER JOIN source_documents
      ON source_documents.id = intake_jobs.source_document_id
    WHERE intake_jobs.id = ?
    LIMIT 1`,
    [jobId],
  )

  if (!row) {
    throw new Error('未找到发票任务，不能重新核对。')
  }

  if (row.stage === 'queued' || row.stage === 'extracting') {
    throw new Error('发票正在抽取中，请等待当前核对完成。')
  }

  if (row.stage === 'deleting') {
    throw new Error('发票任务正在删除，不能重新核对。')
  }

  if (!row.r2Key) {
    throw new Error('发票原始文件缺少 R2 路径，不能重新核对。')
  }

  const startedAt = new Date().toISOString()
  const startResult = await db
    .prepare(
      `/* invoice:recheck-start */
      UPDATE intake_jobs
      SET
        stage = 'extracting',
        error_message = NULL,
        updated_at = ?
      WHERE id = ?
        AND stage NOT IN ('queued', 'extracting', 'deleting')`,
    )
    .bind(startedAt, row.jobId)
    .run()

  assertInvoiceMutationChanged(startResult, '发票正在处理或删除，不能重新核对。')

  try {
    const documentObject = await rawDocumentsBucket.get(row.r2Key)
    if (!documentObject) {
      throw new Error(`R2 object not found: ${row.r2Key}`)
    }

    const mimeType =
      row.mimeType ||
      documentObject.httpMetadata?.contentType ||
      'application/octet-stream'
    const providerInput = await buildInvoiceProviderInput({
      fileName: row.fileName,
      mimeType,
      arrayBuffer: await documentObject.arrayBuffer(),
    })
    const provider = selectInvoiceExtractionProvider(env)
    const extraction = await provider.extract(providerInput)
    const extractionDraft = extraction.draft
    const schemaVersion =
      extractionDraft.schemaVersion ?? INVOICE_EXTRACTION_SCHEMA_VERSION
    const extractionStoredAt = new Date().toISOString()

    const extractionResult = await db
      .prepare(
        `/* invoice:recheck-upsert-extraction */
        INSERT INTO extraction_results (
          id,
          intake_job_id,
          markdown_text,
          structured_json,
          raw_response,
          schema_version,
          created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = ?
            AND intake_jobs.stage = 'extracting'
        )
        ON CONFLICT(id) DO UPDATE SET
          markdown_text = excluded.markdown_text,
          structured_json = excluded.structured_json,
          raw_response = excluded.raw_response,
          schema_version = excluded.schema_version,
          created_at = excluded.created_at`,
      )
      .bind(
        getExtractionResultId(row.jobId),
        row.jobId,
        extractionDraft.markdownText,
        serializeExtractionDraft(extractionDraft),
        extraction.rawResponse,
        schemaVersion,
        extractionStoredAt,
        row.jobId,
      )
      .run()

    assertInvoiceMutationChanged(extractionResult, '发票任务状态已变化，不能保存重新核对结果。')

    const additionalDrafts = extraction.additionalDrafts ?? []
    const currentSiblingJobIds = additionalDrafts.map(
      (additional) => `${row.jobId}_p${additional.pageNumber}`,
    )
    const currentSiblingJobIdSet = new Set(currentSiblingJobIds)
    const staleNonReadySiblingJobIds = (
      await listRecheckSiblingRows(db, {
        originalJobId: row.jobId,
        sourceDocumentId: row.sourceDocumentId,
      })
    )
      .filter(
        (sibling) =>
          !currentSiblingJobIdSet.has(sibling.jobId) && sibling.stage !== 'ready',
      )
      .map((sibling) => sibling.jobId)

    await deleteConfirmedInvoiceAccountingRowsForJobs(db, [
      row.jobId,
      ...currentSiblingJobIds,
    ])

    if (additionalDrafts.length) {
      await persistAdditionalInvoiceExtractionDrafts({
        db,
        originalJobId: row.jobId,
        sourceDocumentId: row.sourceDocumentId,
        providerId: provider.id,
        providerModel: provider.model,
        createdAt: extractionStoredAt,
        additionalDrafts,
        allowReadyOverwrite: true,
      })
    }

    await retireStaleNonReadyRecheckSiblings(db, staleNonReadySiblingJobIds)

    const finishedAt = new Date().toISOString()
    const successResult = await db
      .prepare(
        `/* invoice:recheck-finish */
        UPDATE intake_jobs
        SET
          stage = 'needs_review',
          extractor_provider = ?,
          extractor_model = ?,
          confidence_score = ?,
          error_message = NULL,
          updated_at = ?
        WHERE id = ? AND stage = 'extracting'`,
      )
      .bind(
        provider.id,
        provider.model,
        calculateDraftConfidence(extractionDraft),
        finishedAt,
        row.jobId,
      )
      .run()

    assertInvoiceMutationChanged(successResult, '发票任务状态已变化，不能完成重新核对。')

    await db
      .prepare(
        `/* invoice:recheck-source-processed */
        UPDATE source_documents
        SET status = 'processed'
        WHERE id = ?`,
      )
      .bind(row.sourceDocumentId)
      .run()

    return buildRecheckedInvoiceJob({
      row,
      extractionDraft,
    })
  } catch (error) {
    const failedAt = new Date().toISOString()
    await db
      .prepare(
        `/* invoice:recheck-error */
        UPDATE intake_jobs
        SET
          stage = 'error',
          error_message = ?,
          updated_at = ?
        WHERE id = ? AND stage = 'extracting'`,
      )
      .bind(formatInvoiceMutationError(error), failedAt, row.jobId)
      .run()
    await db
      .prepare(
        `/* invoice:recheck-source-error */
        UPDATE source_documents
        SET status = 'error'
        WHERE id = ?`,
      )
      .bind(row.sourceDocumentId)
      .run()
    throw error
  }
}

async function persistInvoiceReviewDraft(
  env: Partial<AppBindings> | null | undefined,
  job: InvoiceReviewJob,
  nextStage: 'needs_review' | 'ready',
) {
  const db = requireD1Database(env, 'invoice review')
  const latestDraft = await getLatestExtractionDraft(db, job.jobId, job.fileName)
  const nextLineItems = job.lineItems.map((item) => ({
    ...item,
    ingredient: '',
    matched: false,
  }))
  const nextDraft: InvoiceExtractionDraft = {
    ...latestDraft,
    pageCount: job.pageCount,
    header: { ...job.header },
    lineItems: nextLineItems,
  }
  const latestExtraction = await getLatestExtractionRow(db, job.jobId)
  const now = new Date().toISOString()
  await assertInvoiceReviewDraftWritable(db, job.jobId)

  if (latestExtraction) {
    const extractionUpdateResult = await db
      .prepare(
        `/* invoice:update-extraction */
        UPDATE extraction_results
        SET
          structured_json = ?,
          markdown_text = ?,
          raw_response = ?,
          schema_version = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM intake_jobs
            WHERE intake_jobs.id = ?
              AND intake_jobs.stage != 'deleting'
          )`,
      )
      .bind(
        serializeExtractionDraft(nextDraft),
        nextDraft.markdownText,
        JSON.stringify({
          source: 'manual-review',
          updatedAt: now,
        }),
        nextDraft.schemaVersion ?? INVOICE_EXTRACTION_SCHEMA_VERSION,
        latestExtraction.id,
        job.jobId,
      )
      .run()

    assertInvoiceMutationChanged(extractionUpdateResult, '发票任务正在删除，不能保存或确认。')
  } else {
    const extractionInsertResult = await db
      .prepare(
        `/* invoice:insert-extraction */
        INSERT INTO extraction_results (
          id,
          intake_job_id,
          markdown_text,
          structured_json,
          raw_response,
          schema_version,
          created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = ?
            AND intake_jobs.stage != 'deleting'
        )`,
      )
      .bind(
        `ext_${job.jobId}`,
        job.jobId,
        nextDraft.markdownText,
        serializeExtractionDraft(nextDraft),
        JSON.stringify({
          source: 'manual-review',
          createdAt: now,
        }),
        nextDraft.schemaVersion ?? INVOICE_EXTRACTION_SCHEMA_VERSION,
        now,
        job.jobId,
      )
      .run()

    assertInvoiceMutationChanged(extractionInsertResult, '发票任务正在删除，不能保存或确认。')
  }

  const stageUpdateResult = await db
    .prepare(
      `/* invoice:update-intake-stage */
      UPDATE intake_jobs
      SET
        stage = ?,
        error_message = NULL,
        updated_at = ?
      WHERE id = ? AND stage != 'deleting'`,
    )
    .bind(nextStage, now, job.jobId)
    .run()

  if ((stageUpdateResult.meta?.changes ?? 0) === 0) {
    throw new Error('发票任务正在删除，不能保存或确认。')
  }

  return {
    ...job,
    stage: nextStage,
    errorMessage: null,
    lineItems: nextLineItems,
    status: mapIntakeStageToInvoiceStatus(nextStage),
  }
}

async function listRecheckSiblingRows(
  db: D1Database,
  input: {
    originalJobId: string
    sourceDocumentId: string
  },
) {
  return allD1<RecheckSiblingRow>(
    db,
    `/* invoice:recheck-list-siblings */
    SELECT id AS jobId, stage
    FROM intake_jobs
    WHERE source_document_id = ?
      AND id LIKE ? ESCAPE '\\'`,
    [input.sourceDocumentId, `${escapeSqlLike(input.originalJobId)}\\_p%`],
  )
}

async function deleteConfirmedInvoiceAccountingRowsForJobs(
  db: D1Database,
  jobIds: string[],
) {
  if (jobIds.length === 0) {
    return
  }

  const placeholders = jobIds.map(() => '?').join(', ')
  const invoiceRows = await allD1<InvoiceIdRow>(
    db,
    `/* invoice:recheck-list-accounting-invoices */
    SELECT id
    FROM invoices
    WHERE intake_job_id IN (${placeholders})`,
    jobIds,
  )
  const invoiceIds = Array.from(
    new Set([...invoiceRows.map((row) => row.id), ...jobIds.map(getInvoiceId)]),
  )

  if (invoiceIds.length === 0) {
    return
  }

  await deleteConfirmedInvoiceAccountingRows(db, invoiceIds)
}

async function deleteConfirmedInvoiceAccountingRows(
  db: D1Database,
  invoiceIds: string[],
) {
  const placeholders = invoiceIds.map(() => '?').join(', ')
  const statements = [
    db
      .prepare(
        `/* invoice:recheck-delete-ledger */
        DELETE FROM ledger_entries
        WHERE source_kind = 'invoice'
          AND source_id IN (${placeholders})`,
      )
      .bind(...invoiceIds),
    db
      .prepare(
        `/* invoice:recheck-delete-items */
        DELETE FROM invoice_items
        WHERE invoice_id IN (${placeholders})`,
      )
      .bind(...invoiceIds),
    db
      .prepare(
        `/* invoice:recheck-delete-invoice */
        DELETE FROM invoices
        WHERE id IN (${placeholders})`,
      )
      .bind(...invoiceIds),
  ]

  if (typeof db.batch === 'function') {
    await db.batch(statements)
    return
  }

  for (const statement of statements) {
    await statement.run()
  }
}

function escapeSqlLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

async function retireStaleNonReadyRecheckSiblings(
  db: D1Database,
  siblingJobIds: string[],
) {
  if (siblingJobIds.length === 0) {
    return
  }

  const placeholders = siblingJobIds.map(() => '?').join(', ')

  await db
    .prepare(
      `/* invoice:recheck-retire-stale-sibling-extractions */
      DELETE FROM extraction_results
      WHERE intake_job_id IN (${placeholders})
        AND EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = extraction_results.intake_job_id
            AND intake_jobs.stage != 'ready'
        )`,
    )
    .bind(...siblingJobIds)
    .run()

  await db
    .prepare(
      `/* invoice:recheck-retire-stale-sibling-jobs */
      DELETE FROM intake_jobs
      WHERE id IN (${placeholders})
        AND stage != 'ready'`,
    )
    .bind(...siblingJobIds)
    .run()
}

function buildRecheckedInvoiceJob(input: {
  row: RecheckSourceRow
  extractionDraft: InvoiceExtractionDraft
}): InvoiceReviewJob {
  return {
    jobId: input.row.jobId,
    fileName: input.row.fileName,
    uploadedAt: input.row.uploadedAt,
    pageCount: Math.max(1, input.extractionDraft.pageCount),
    status: 'needs_review',
    stage: 'needs_review',
    errorMessage: null,
    header: input.extractionDraft.header,
    lineItems: input.extractionDraft.lineItems.map((item) => ({ ...item })),
    extraction: {
      provider: input.extractionDraft.provider,
      model: input.extractionDraft.model,
      overallConfidence: input.extractionDraft.confidence?.overall,
      warnings: input.extractionDraft.warnings ?? [],
      schemaVersion:
        input.extractionDraft.schemaVersion ?? INVOICE_EXTRACTION_SCHEMA_VERSION,
    },
  }
}

function formatInvoiceMutationError(error: unknown) {
  return error instanceof Error ? error.message : '重新核对失败。'
}

async function writeConfirmedInvoiceAccounting(
  env: Partial<AppBindings> | null | undefined,
  job: InvoiceReviewJob,
) {
  const db = requireD1Database(env, 'invoice accounting')
  await assertInvoiceReviewDraftWritable(db, job.jobId)
  const sourceDocumentId = await getSourceDocumentId(db, job.jobId)
  const preferredInvoiceId = getInvoiceId(job.jobId)
  const invoiceDedupeKey = getInvoiceDedupeKey(job)
  const totalAmount = parseCurrencyAmount(job.header.totalAmount)
  const taxAmount = parseCurrencyAmount(job.header.taxAmount)
  const subtotalAmount = roundCurrency(totalAmount - taxAmount)
  const now = new Date().toISOString()
  const existingInvoiceId = await getSameJobInvoiceId(db, job.jobId)
  let persistedInvoiceId = existingInvoiceId

  if (persistedInvoiceId) {
    const targetInvoiceId = await getInvoiceIdByDedupeKey(db, invoiceDedupeKey)

    if (targetInvoiceId && targetInvoiceId !== persistedInvoiceId) {
      await deleteRetiredInvoiceAccounting(db, job.jobId, persistedInvoiceId)
      persistedInvoiceId = targetInvoiceId
    }

    const invoiceUpdateResult = await db
      .prepare(
        targetInvoiceId && targetInvoiceId === persistedInvoiceId
          ? `/* invoice:merge-into-existing-dedupe */
        UPDATE invoices
        SET
          intake_job_id = ?,
          invoice_date = ?,
          supplier_name = ?,
          document_number = ?,
          subtotal_amount = ?,
          tax_amount = ?,
          total_amount = ?,
          source_document_id = ?,
          dedupe_key = ?,
          review_status = 'ready',
          updated_at = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM intake_jobs
            WHERE intake_jobs.id = ?
              AND intake_jobs.stage = 'ready'
          )`
          : `/* invoice:update-existing-invoice */
        UPDATE invoices
        SET
          intake_job_id = ?,
          invoice_date = ?,
          supplier_name = ?,
          document_number = ?,
          subtotal_amount = ?,
          tax_amount = ?,
          total_amount = ?,
          source_document_id = ?,
          dedupe_key = ?,
          review_status = 'ready',
          updated_at = ?
        WHERE id = ?
          AND intake_job_id = ?
          AND EXISTS (
            SELECT 1
            FROM intake_jobs
            WHERE intake_jobs.id = ?
              AND intake_jobs.stage = 'ready'
          )`,
      )
      .bind(
        job.jobId,
        job.header.date,
        job.header.supplier.trim(),
        job.header.invoiceNo.trim(),
        subtotalAmount,
        taxAmount,
        totalAmount,
        sourceDocumentId,
        invoiceDedupeKey,
        now,
        persistedInvoiceId,
        ...(targetInvoiceId && targetInvoiceId === persistedInvoiceId
          ? [job.jobId]
          : [job.jobId, job.jobId]),
      )
      .run()

    assertInvoiceMutationChanged(
      invoiceUpdateResult,
      '发票任务正在删除，不能保存或确认。',
    )
  } else {
    const invoiceId = await getAvailableInvoiceId(
      db,
      preferredInvoiceId,
      invoiceDedupeKey,
    )
    const invoiceUpsertResult = await db
      .prepare(
        `/* invoice:upsert-invoice */
        INSERT INTO invoices (
          id,
          intake_job_id,
          invoice_date,
          supplier_name,
          document_number,
          subtotal_amount,
          tax_amount,
          total_amount,
          source_document_id,
          dedupe_key,
          review_status,
          updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?
        WHERE EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = ?
            AND intake_jobs.stage = 'ready'
        )
        ON CONFLICT(dedupe_key) DO UPDATE SET
          intake_job_id = excluded.intake_job_id,
          invoice_date = excluded.invoice_date,
          supplier_name = excluded.supplier_name,
          document_number = excluded.document_number,
          subtotal_amount = excluded.subtotal_amount,
          tax_amount = excluded.tax_amount,
          total_amount = excluded.total_amount,
          source_document_id = excluded.source_document_id,
          review_status = excluded.review_status,
          updated_at = excluded.updated_at`,
      )
      .bind(
        invoiceId,
        job.jobId,
        job.header.date,
        job.header.supplier.trim(),
        job.header.invoiceNo.trim(),
        subtotalAmount,
        taxAmount,
        totalAmount,
        sourceDocumentId,
        invoiceDedupeKey,
        now,
        job.jobId,
      )
      .run()

    assertInvoiceMutationChanged(
      invoiceUpsertResult,
      '发票任务正在删除，不能保存或确认。',
    )

    persistedInvoiceId = await getPersistedInvoiceId(db, invoiceDedupeKey)
  }

  const ledgerEntryId = getLedgerEntryId(persistedInvoiceId)

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `/* invoice:delete-items */
        DELETE FROM invoice_items
        WHERE invoice_id = ?`,
      )
      .bind(persistedInvoiceId),
    ...job.lineItems.map((item, index) =>
      db
        .prepare(
          `/* invoice:insert-item */
          INSERT INTO invoice_items (
            id,
            invoice_id,
            raw_product_name,
            raw_quantity,
            raw_unit,
            raw_unit_price,
            raw_line_total,
            ingredient_id,
            normalized_quantity,
            normalized_unit,
            normalized_unit_price,
            mapping_status,
            valid_price
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          getInvoiceItemId(persistedInvoiceId, index),
          persistedInvoiceId,
          item.name.trim(),
          parseOptionalCurrencyAmount(item.qty),
          item.unit.trim() || null,
          parseOptionalCurrencyAmount(item.unitPrice),
          parseOptionalCurrencyAmount(item.lineTotal ?? '') ??
            calculateLineTotal(item.qty, item.unitPrice),
          item.ingredient.trim() || null,
          parseOptionalCurrencyAmount(item.qty),
          item.unit.trim() || null,
          parseOptionalCurrencyAmount(item.unitPrice),
          item.ingredient.trim() ? 'matched' : 'unmatched',
          item.excludeFromPriceTracking ? 0 : 1,
        ),
    ),
    db
      .prepare(
        `/* invoice:upsert-ledger */
        INSERT INTO ledger_entries (
          id,
          entry_date,
          entry_type,
          category,
          amount,
          vendor,
          source_kind,
          source_id,
          created_at
        )
        VALUES (?, ?, 'expense', 'purchase', ?, ?, 'invoice', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          entry_date = excluded.entry_date,
          amount = excluded.amount,
          vendor = excluded.vendor,
          source_id = excluded.source_id`,
      )
      .bind(
        ledgerEntryId,
        job.header.date,
        totalAmount,
        job.header.supplier.trim(),
        persistedInvoiceId,
        now,
      ),
  ]

  if (typeof db.batch === 'function') {
    await db.batch(statements)
    return
  }

  for (const statement of statements) {
    await statement.run()
  }
}

async function getLatestExtractionDraft(
  db: D1Database,
  jobId: string,
  fileName: string,
) {
  const latestExtraction = await getLatestExtractionRow(db, jobId)
  return parseStoredExtractionDraft(latestExtraction?.structuredJson, fileName)
}

async function getLatestExtractionRow(db: D1Database, jobId: string) {
  const rows = await allD1<LatestExtractionRow>(
    db,
    `/* invoice:latest-extraction */
    SELECT
      id,
      structured_json AS structuredJson,
      markdown_text AS markdownText
    FROM extraction_results
    WHERE intake_job_id = ?
    ORDER BY created_at DESC
    LIMIT 1`,
    [jobId],
  )

  return rows[0] ?? null
}

async function getSourceDocumentId(db: D1Database, jobId: string) {
  const rows = await allD1<IntakeSourceRow>(
    db,
    `/* invoice:get-intake-source */
    SELECT source_document_id AS sourceDocumentId
    FROM intake_jobs
    WHERE id = ?
    LIMIT 1`,
    [jobId],
  )
  const sourceDocumentId = rows[0]?.sourceDocumentId

  if (!sourceDocumentId) {
    throw new Error(`Invoice intake job not found: ${jobId}`)
  }

  return sourceDocumentId
}

async function getPersistedInvoiceId(db: D1Database, dedupeKey: string) {
  const invoiceId = await getInvoiceIdByDedupeKey(db, dedupeKey)

  if (!invoiceId) {
    throw new Error(`Confirmed invoice was not persisted: ${dedupeKey}`)
  }

  return invoiceId
}

async function getInvoiceIdByDedupeKey(db: D1Database, dedupeKey: string) {
  const rows = await allD1<InvoiceIdRow>(
    db,
    `/* invoice:get-persisted-invoice-id */
    SELECT id
    FROM invoices
    WHERE dedupe_key = ?
    LIMIT 1`,
    [dedupeKey],
  )
  const invoiceId = rows[0]?.id

  return invoiceId ?? null
}

async function getSameJobInvoiceId(db: D1Database, jobId: string) {
  const rows = await allD1<InvoiceIdRow>(
    db,
    `/* invoice:resolve-existing-invoice */
    SELECT id
    FROM invoices
    WHERE intake_job_id = ?
    LIMIT 1`,
    [jobId],
  )

  return rows[0]?.id ?? null
}

async function deleteRetiredInvoiceAccounting(
  db: D1Database,
  jobId: string,
  invoiceId: string,
) {
  await db
    .prepare(
      `/* invoice:delete-retired-ledger */
      DELETE FROM ledger_entries
      WHERE source_kind = 'invoice'
        AND source_id = ?
        AND EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = ?
            AND intake_jobs.stage = 'ready'
        )`,
    )
    .bind(invoiceId, jobId)
    .run()

  await db
    .prepare(
      `/* invoice:delete-retired-items */
      DELETE FROM invoice_items
      WHERE invoice_id = ?
        AND EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = ?
            AND intake_jobs.stage = 'ready'
        )`,
    )
    .bind(invoiceId, jobId)
    .run()

  const invoiceDeleteResult = await db
    .prepare(
      `/* invoice:delete-retired-invoice */
      DELETE FROM invoices
      WHERE id = ?
        AND intake_job_id = ?
        AND EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE intake_jobs.id = ?
            AND intake_jobs.stage = 'ready'
        )`,
    )
    .bind(invoiceId, jobId, jobId)
    .run()

  assertInvoiceMutationChanged(
    invoiceDeleteResult,
    '发票任务正在删除，不能保存或确认。',
  )
}

async function getAvailableInvoiceId(
  db: D1Database,
  preferredInvoiceId: string,
  dedupeKey: string,
) {
  const hash = getStableInvoiceKeyHash(dedupeKey)

  for (let suffix = 0; suffix < 20; suffix += 1) {
    const candidate =
      suffix === 0
        ? preferredInvoiceId
        : suffix === 1
          ? `${preferredInvoiceId}_${hash}`
          : `${preferredInvoiceId}_${hash}_${suffix}`

    if (!(await invoiceIdExists(db, candidate))) {
      return candidate
    }
  }

  throw new Error(`Could not allocate invoice id for job invoice ${preferredInvoiceId}`)
}

async function invoiceIdExists(db: D1Database, invoiceId: string) {
  const rows = await allD1<InvoiceIdRow>(
    db,
    `/* invoice:get-invoice-id */
    SELECT id
    FROM invoices
    WHERE id = ?
    LIMIT 1`,
    [invoiceId],
  )

  return Boolean(rows[0]?.id)
}

async function assertInvoiceReviewDraftWritable(db: D1Database, jobId: string) {
  const rows = await allD1<IntakeStageRow>(
    db,
    `/* invoice:review-draft-stage */
    SELECT stage
    FROM intake_jobs
    WHERE id = ?
    LIMIT 1`,
    [jobId],
  )

  if (rows[0]?.stage === 'deleting') {
    throw new Error('发票任务正在删除，不能保存或确认。')
  }
}

function assertInvoiceMutationChanged(result: D1Result, message: string) {
  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(message)
  }
}

function calculateLineTotal(quantity: string, unitPrice: string) {
  const normalizedQuantity = parseOptionalCurrencyAmount(quantity)
  const normalizedUnitPrice = parseOptionalCurrencyAmount(unitPrice)

  if (normalizedQuantity === null || normalizedUnitPrice === null) {
    return null
  }

  return roundCurrency(normalizedQuantity * normalizedUnitPrice)
}

function getInvoiceId(jobId: string) {
  return `inv_${jobId}`
}

function getInvoiceDedupeKey(job: InvoiceReviewJob) {
  return [
    job.header.supplier.trim().toLowerCase(),
    job.header.invoiceNo.trim(),
    job.header.date.trim(),
  ].join('|')
}

function getStableInvoiceKeyHash(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function getInvoiceItemId(invoiceId: string, index: number) {
  return `${invoiceId}_item_${index + 1}`
}

function getLedgerEntryId(invoiceId: string) {
  return `ledger_${invoiceId}`
}
