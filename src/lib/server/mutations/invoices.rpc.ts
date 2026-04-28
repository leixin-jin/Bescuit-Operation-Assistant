import { createServerFn } from '@tanstack/react-start'

import { validateInvoiceUpload } from '@/features/invoices/intake-file-validation'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
import {
  getInvoiceReadinessSummary,
  parseCurrencyAmount,
  parseOptionalCurrencyAmount,
  roundCurrency,
  type InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  mapIntakeStageToInvoiceStatus,
  parseStoredExtractionDraft,
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

async function persistInvoiceReviewDraft(
  env: Partial<AppBindings> | null | undefined,
  job: InvoiceReviewJob,
  nextStage: 'needs_review' | 'ready',
) {
  const db = requireD1Database(env, 'invoice review')
  const latestDraft = await getLatestExtractionDraft(db, job.jobId, job.fileName)
  const nextLineItems = job.lineItems.map((item) => ({
    ...item,
    matched: Boolean(item.ingredient.trim()),
  }))
  const nextDraft: InvoiceExtractionDraft = {
    ...latestDraft,
    pageCount: job.pageCount,
    header: { ...job.header },
    lineItems: nextLineItems,
  }
  const latestExtraction = await getLatestExtractionRow(db, job.jobId)
  const now = new Date().toISOString()

  if (latestExtraction) {
    await db
      .prepare(
        `/* invoice:update-extraction */
        UPDATE extraction_results
        SET
          structured_json = ?,
          markdown_text = ?,
          raw_response = ?
        WHERE id = ?`,
      )
      .bind(
        serializeExtractionDraft(nextDraft),
        nextDraft.markdownText,
        JSON.stringify({
          source: 'manual-review',
          updatedAt: now,
        }),
        latestExtraction.id,
      )
      .run()
  } else {
    await db
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
        VALUES (?, ?, ?, ?, ?, 'invoice-extraction-v1', ?)`,
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
        now,
      )
      .run()
  }

  await db
    .prepare(
      `/* invoice:update-intake-stage */
      UPDATE intake_jobs
      SET
        stage = ?,
        error_message = NULL,
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(nextStage, now, job.jobId)
    .run()

  return {
    ...job,
    stage: nextStage,
    errorMessage: null,
    lineItems: nextLineItems,
    status: mapIntakeStageToInvoiceStatus(nextStage),
  }
}

async function writeConfirmedInvoiceAccounting(
  env: Partial<AppBindings> | null | undefined,
  job: InvoiceReviewJob,
) {
  const db = requireD1Database(env, 'invoice accounting')
  const sourceDocumentId = await getSourceDocumentId(db, job.jobId)
  const invoiceId = getInvoiceId(job.jobId)
  const ledgerEntryId = getLedgerEntryId(invoiceId)
  const totalAmount = parseCurrencyAmount(job.header.totalAmount)
  const taxAmount = parseCurrencyAmount(job.header.taxAmount)
  const subtotalAmount = roundCurrency(totalAmount - taxAmount)
  const now = new Date().toISOString()
  const statements: D1PreparedStatement[] = [
    db
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
          review_status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)
        ON CONFLICT(id) DO UPDATE SET
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
        now,
      ),
    db
      .prepare(
        `/* invoice:delete-items */
        DELETE FROM invoice_items
        WHERE invoice_id = ?`,
      )
      .bind(invoiceId),
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
            mapping_status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          getInvoiceItemId(invoiceId, index),
          invoiceId,
          item.name.trim(),
          parseOptionalCurrencyAmount(item.qty),
          item.unit.trim() || null,
          parseOptionalCurrencyAmount(item.unitPrice),
          calculateLineTotal(item.qty, item.unitPrice),
          item.ingredient.trim() || null,
          parseOptionalCurrencyAmount(item.qty),
          item.unit.trim() || null,
          parseOptionalCurrencyAmount(item.unitPrice),
          item.ingredient.trim() ? 'matched' : 'unmatched',
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
        invoiceId,
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

function getInvoiceItemId(invoiceId: string, index: number) {
  return `${invoiceId}_item_${index + 1}`
}

function getLedgerEntryId(invoiceId: string) {
  return `ledger_${invoiceId}`
}
