import { and, eq } from 'drizzle-orm'

import { getDb } from '@/lib/db/client'
import { intakeJobs, sourceDocuments } from '@/lib/db/schema'
import type { AppBindings } from '@/lib/server/bindings'
import { requireBinding } from '@/lib/server/bindings'
import { allD1, firstD1, requireD1Database } from '@/lib/server/d1'
import { enqueueInvoiceIntakeJob } from '@/lib/server/queue'
import { selectInvoiceExtractionProvider } from '@/lib/server/extraction'

export interface InvoiceUploadResult {
  jobId: string
  sourceDocumentId: string
  r2Key: string
}

interface ExistingInvoiceUploadRow {
  jobId: string
  sourceDocumentId: string
  r2Key: string | null
}

interface ExistingInvoiceSourceDocumentRow {
  sourceDocumentId: string
  r2Key: string | null
  fileName: string
  mimeType: string | null
  uploadedAt: string
}

interface ExistingInvoiceJobRow extends ExistingInvoiceUploadRow {
  fileName: string
  mimeType: string | null
  uploadedAt: string
}

export async function uploadInvoiceSourceDocument(input: {
  env: AppBindings
  file: File
  uploadedBy?: string | null
}) {
  const db = getDb(input.env)
  const d1 = requireD1Database(input.env, 'invoice upload')
  const rawDocumentsBucket = requireBinding(input.env.RAW_DOCUMENTS, 'RAW_DOCUMENTS')

  if (!db) {
    throw new Error('Missing Cloudflare binding: DB')
  }

  const contentHash = await getFileSha256HexDigest(input.file)
  const existingUpload = await findExistingInvoiceUpload(d1, contentHash)

  if (existingUpload?.r2Key) {
    return {
      jobId: existingUpload.jobId,
      sourceDocumentId: existingUpload.sourceDocumentId,
      r2Key: existingUpload.r2Key,
    } satisfies InvoiceUploadResult
  }

  const sourceDocumentId = `src_${crypto.randomUUID()}`
  const jobId = `job_${crypto.randomUUID()}`
  const uploadedAt = new Date().toISOString()
  const r2Key = buildRawDocumentKey({
    sourceDocumentId,
    uploadedAt,
    fileName: input.file.name,
  })

  let objectStored = false
  let sourceDocumentStored = false
  let intakeJobStored = false
  let uploadedObjectAdoptedByExistingSource = false

  try {
    await rawDocumentsBucket.put(r2Key, input.file, {
      httpMetadata: {
        contentType: input.file.type || undefined,
      },
    })
    objectStored = true

    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      sourceType: 'invoice-upload',
      documentTypeGuess: 'invoice',
      r2Key,
      originalFilename: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      contentHash,
      uploadedBy: input.uploadedBy ?? null,
      status: 'uploaded',
      uploadedAt,
    })
    sourceDocumentStored = true

    const jobInserted = await insertQueuedInvoiceJobIfNoBlockingJob({
      env: input.env,
      d1,
      jobId,
      sourceDocumentId,
      queuedAt: uploadedAt,
    })

    if (!jobInserted) {
      const activeJob = await findExistingInvoiceUploadForSource(d1, sourceDocumentId)

      if (activeJob?.r2Key) {
        return {
          jobId: activeJob.jobId,
          sourceDocumentId: activeJob.sourceDocumentId,
          r2Key: activeJob.r2Key,
        } satisfies InvoiceUploadResult
      }

      await throwIfDeletingInvoiceJobExists(d1, sourceDocumentId)

      throw new Error('Unable to create or recover an invoice intake job.')
    }

    intakeJobStored = true

    await enqueueInvoiceIntakeJob(input.env, {
      jobId,
      sourceDocumentId,
      r2Key,
      fileName: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      uploadedAt,
    })
  } catch (error) {
    let recoveredDuplicate: InvoiceUploadResult | null = null

    try {
      recoveredDuplicate = await recoverDuplicateUploadConflict({
        env: input.env,
        db,
        d1,
        rawDocumentsBucket,
        contentHash,
        uploadedR2Key: objectStored ? r2Key : null,
        error,
        onUploadedObjectAdopted: () => {
          uploadedObjectAdoptedByExistingSource = true
        },
      })
    } catch (recoveryError) {
      await recoverFailedUpload({
        db,
        rawDocumentsBucket,
        r2Key,
        sourceDocumentId,
        jobId,
        objectStored: objectStored && !uploadedObjectAdoptedByExistingSource,
        sourceDocumentStored,
        intakeJobStored,
        error: recoveryError,
      })

      throw recoveryError
    }

    if (recoveredDuplicate) {
      if (
        objectStored &&
        !uploadedObjectAdoptedByExistingSource &&
        recoveredDuplicate.r2Key !== r2Key
      ) {
        await Promise.allSettled([rawDocumentsBucket.delete(r2Key)])
      }

      return recoveredDuplicate
    }

    await recoverFailedUpload({
      db,
      rawDocumentsBucket,
      r2Key,
      sourceDocumentId,
      jobId,
      objectStored: objectStored && !uploadedObjectAdoptedByExistingSource,
      sourceDocumentStored,
      intakeJobStored,
      error,
    })

    throw error
  }

  return {
    jobId,
    sourceDocumentId,
    r2Key,
  } satisfies InvoiceUploadResult
}

async function getFileSha256HexDigest(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function findExistingInvoiceUpload(
  db: D1Database,
  contentHash: string,
) {
  const rows = await allD1<ExistingInvoiceUploadRow>(
    db,
    `
      /* invoice-upload:find-duplicate */
      SELECT intake_jobs.id AS jobId,
        source_documents.id AS sourceDocumentId,
        source_documents.r2_key AS r2Key
      FROM source_documents
      INNER JOIN intake_jobs
        ON intake_jobs.source_document_id = source_documents.id
      WHERE source_documents.content_hash = ?
        AND source_documents.source_type = 'invoice-upload'
        AND intake_jobs.stage IN ('queued', 'extracting', 'needs_review', 'ready')
      ORDER BY intake_jobs.created_at DESC
      LIMIT 1
    `,
    [contentHash],
  )

  return rows[0] ?? null
}

async function recoverDuplicateUploadConflict(input: {
  env: AppBindings
  db: NonNullable<ReturnType<typeof getDb>>
  d1: D1Database
  rawDocumentsBucket: R2Bucket
  contentHash: string
  uploadedR2Key: string | null
  error: unknown
  onUploadedObjectAdopted?: () => void
}) {
  if (!isContentHashUniqueConstraintError(input.error)) {
    return null
  }

  const existingUpload = await findExistingInvoiceUpload(input.d1, input.contentHash)

  if (existingUpload?.r2Key) {
    return {
      jobId: existingUpload.jobId,
      sourceDocumentId: existingUpload.sourceDocumentId,
      r2Key: existingUpload.r2Key,
    } satisfies InvoiceUploadResult
  }

  const existingSourceDocument = await findExistingInvoiceSourceDocument(
    input.d1,
    input.contentHash,
  )

  if (!existingSourceDocument?.r2Key) {
    return null
  }

  await throwIfDeletingInvoiceJobExists(
    input.d1,
    existingSourceDocument.sourceDocumentId,
  )

  const sourceDocument = await resolveReusableSourceDocumentObject({
    d1: input.d1,
    rawDocumentsBucket: input.rawDocumentsBucket,
    sourceDocument: {
      ...existingSourceDocument,
      r2Key: existingSourceDocument.r2Key,
    },
    uploadedR2Key: input.uploadedR2Key,
    onUploadedObjectAdopted: input.onUploadedObjectAdopted,
  })

  if (!sourceDocument) {
    return null
  }

  return requeueOrCreateInvoiceJobForExistingSource({
    env: input.env,
    db: input.db,
    d1: input.d1,
    sourceDocument: {
      ...sourceDocument,
      r2Key: sourceDocument.r2Key,
    },
  })
}

async function findExistingInvoiceSourceDocument(
  db: D1Database,
  contentHash: string,
) {
  const rows = await allD1<ExistingInvoiceSourceDocumentRow>(
    db,
    `
      /* invoice-upload:find-source-by-hash */
      SELECT source_documents.id AS sourceDocumentId,
        source_documents.r2_key AS r2Key,
        source_documents.original_filename AS fileName,
        source_documents.mime_type AS mimeType,
        source_documents.uploaded_at AS uploadedAt
      FROM source_documents
      WHERE source_documents.content_hash = ?
        AND source_documents.source_type = 'invoice-upload'
        AND source_documents.r2_key IS NOT NULL
      ORDER BY source_documents.uploaded_at DESC
      LIMIT 1
    `,
    [contentHash],
  )

  return rows[0] ?? null
}

async function requeueOrCreateInvoiceJobForExistingSource(input: {
  env: AppBindings
  db: NonNullable<ReturnType<typeof getDb>>
  d1: D1Database
  sourceDocument: ExistingInvoiceSourceDocumentRow & { r2Key: string }
}) {
  const queuedAt = new Date().toISOString()
  const mimeType = input.sourceDocument.mimeType || 'application/octet-stream'

  await throwIfDeletingInvoiceJobExists(
    input.d1,
    input.sourceDocument.sourceDocumentId,
  )

  const errorJob = await findLatestErrorInvoiceJobForSource(
    input.d1,
    input.sourceDocument.sourceDocumentId,
  )

  if (errorJob) {
    const claimed = await requeueErrorInvoiceJobIfNoBlockingJob({
      env: input.env,
      d1: input.d1,
      jobId: errorJob.jobId,
      sourceDocumentId: input.sourceDocument.sourceDocumentId,
      queuedAt,
    })

    if (claimed) {
      await input.db
        .update(sourceDocuments)
        .set({
          status: 'uploaded',
        })
        .where(eq(sourceDocuments.id, input.sourceDocument.sourceDocumentId))

      await enqueueClaimedInvoiceJob({
        env: input.env,
        db: input.db,
        sourceDocument: input.sourceDocument,
        jobId: errorJob.jobId,
        mimeType,
      })

      return {
        jobId: errorJob.jobId,
        sourceDocumentId: input.sourceDocument.sourceDocumentId,
        r2Key: input.sourceDocument.r2Key,
      } satisfies InvoiceUploadResult
    }

    await throwIfDeletingInvoiceJobExists(
      input.d1,
      input.sourceDocument.sourceDocumentId,
    )
  }

  const activeJob = await findExistingInvoiceUploadForSource(
    input.d1,
    input.sourceDocument.sourceDocumentId,
  )

  if (activeJob?.r2Key) {
    return {
      jobId: activeJob.jobId,
      sourceDocumentId: activeJob.sourceDocumentId,
      r2Key: activeJob.r2Key,
    } satisfies InvoiceUploadResult
  }

  const jobId = `job_${crypto.randomUUID()}`
  const jobInserted = await insertQueuedInvoiceJobIfNoBlockingJob({
    env: input.env,
    d1: input.d1,
    jobId,
    sourceDocumentId: input.sourceDocument.sourceDocumentId,
    queuedAt,
  })

  if (!jobInserted) {
    const existingJob = await findExistingInvoiceUploadForSource(
      input.d1,
      input.sourceDocument.sourceDocumentId,
    )

    if (existingJob?.r2Key) {
      return {
        jobId: existingJob.jobId,
        sourceDocumentId: existingJob.sourceDocumentId,
        r2Key: existingJob.r2Key,
      } satisfies InvoiceUploadResult
    }

    await throwIfDeletingInvoiceJobExists(
      input.d1,
      input.sourceDocument.sourceDocumentId,
    )

    return null
  }

  await input.db
    .update(sourceDocuments)
    .set({
      status: 'uploaded',
    })
    .where(eq(sourceDocuments.id, input.sourceDocument.sourceDocumentId))

  await enqueueClaimedInvoiceJob({
    env: input.env,
    db: input.db,
    sourceDocument: input.sourceDocument,
    jobId,
    mimeType,
  })

  return {
    jobId,
    sourceDocumentId: input.sourceDocument.sourceDocumentId,
    r2Key: input.sourceDocument.r2Key,
  } satisfies InvoiceUploadResult
}

async function enqueueClaimedInvoiceJob(input: {
  env: AppBindings
  db: NonNullable<ReturnType<typeof getDb>>
  sourceDocument: ExistingInvoiceSourceDocumentRow & { r2Key: string }
  jobId: string
  mimeType: string
}) {
  try {
    await enqueueInvoiceIntakeJob(input.env, {
      jobId: input.jobId,
      sourceDocumentId: input.sourceDocument.sourceDocumentId,
      r2Key: input.sourceDocument.r2Key,
      fileName: input.sourceDocument.fileName,
      mimeType: input.mimeType,
      uploadedAt: input.sourceDocument.uploadedAt,
    })
  } catch (error) {
    await markQueuedDuplicateRecoveryFailed({
      db: input.db,
      sourceDocumentId: input.sourceDocument.sourceDocumentId,
      jobId: input.jobId,
      error,
    })

    throw error
  }
}

async function insertQueuedInvoiceJobIfNoBlockingJob(input: {
  env: AppBindings
  d1: D1Database
  jobId: string
  sourceDocumentId: string
  queuedAt: string
}) {
  const provider = selectInvoiceExtractionProvider(input.env)
  const result = await input.d1
    .prepare(
      `
        /* invoice-upload:insert-job-if-no-active invoice-upload:insert-job-if-no-blocking */
        INSERT INTO intake_jobs (
          id,
          source_document_id,
          extractor_provider,
          extractor_model,
          stage,
          created_at,
          updated_at
        )
        SELECT ?, ?, ?, ?, 'queued', ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM intake_jobs
          WHERE source_document_id = ?
            AND stage IN ('queued', 'extracting', 'needs_review', 'ready', 'deleting')
        )
      `,
    )
    .bind(
      input.jobId,
      input.sourceDocumentId,
      provider.id,
      provider.model,
      input.queuedAt,
      input.queuedAt,
      input.sourceDocumentId,
    )
    .run()

  return (result.meta?.changes ?? 0) === 1
}

async function findExistingInvoiceUploadForSource(
  db: D1Database,
  sourceDocumentId: string,
) {
  return firstD1<ExistingInvoiceJobRow>(
    db,
    `
      /* invoice-upload:find-active-by-source */
      SELECT intake_jobs.id AS jobId,
        source_documents.id AS sourceDocumentId,
        source_documents.r2_key AS r2Key,
        source_documents.original_filename AS fileName,
        source_documents.mime_type AS mimeType,
        source_documents.uploaded_at AS uploadedAt
      FROM source_documents
      INNER JOIN intake_jobs
        ON intake_jobs.source_document_id = source_documents.id
      WHERE source_documents.id = ?
        AND intake_jobs.stage IN ('queued', 'extracting', 'needs_review', 'ready')
      ORDER BY intake_jobs.created_at DESC
      LIMIT 1
    `,
    [sourceDocumentId],
  )
}

async function findLatestErrorInvoiceJobForSource(
  db: D1Database,
  sourceDocumentId: string,
) {
  return firstD1<{ jobId: string }>(
    db,
    `
      /* invoice-upload:find-error-job-by-source */
      SELECT id AS jobId
      FROM intake_jobs
      WHERE source_document_id = ?
        AND stage = 'error'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [sourceDocumentId],
  )
}

async function requeueErrorInvoiceJobIfNoBlockingJob(input: {
  env: AppBindings
  d1: D1Database
  jobId: string
  sourceDocumentId: string
  queuedAt: string
}) {
  const provider = selectInvoiceExtractionProvider(input.env)
  const result = await input.d1
    .prepare(
      `
        /* invoice-upload:requeue-error-job-if-no-active invoice-upload:requeue-error-job-if-no-blocking */
        UPDATE intake_jobs
        SET stage = 'queued',
          extractor_provider = ?,
          extractor_model = ?,
          confidence_score = NULL,
          error_message = NULL,
          updated_at = ?
        WHERE id = ?
          AND source_document_id = ?
          AND stage = 'error'
          AND NOT EXISTS (
            SELECT 1
            FROM intake_jobs
            WHERE source_document_id = ?
              AND stage IN ('queued', 'extracting', 'needs_review', 'ready', 'deleting')
          )
      `,
    )
    .bind(
      provider.id,
      provider.model,
      input.queuedAt,
      input.jobId,
      input.sourceDocumentId,
      input.sourceDocumentId,
    )
    .run()

  return (result.meta?.changes ?? 0) === 1
}

async function throwIfDeletingInvoiceJobExists(
  db: D1Database,
  sourceDocumentId: string,
) {
  const deletingJob = await firstD1<{ jobId: string }>(
    db,
    `
      /* invoice-upload:find-deleting-by-source */
      SELECT id AS jobId
      FROM intake_jobs
      WHERE source_document_id = ?
        AND stage = 'deleting'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [sourceDocumentId],
  )

  if (deletingJob) {
    throw new Error(
      'This invoice upload is currently being deleted. Upload it again after deletion finishes.',
    )
  }
}

async function resolveReusableSourceDocumentObject(input: {
  d1: D1Database
  rawDocumentsBucket: R2Bucket
  sourceDocument: ExistingInvoiceSourceDocumentRow & { r2Key: string }
  uploadedR2Key: string | null
  onUploadedObjectAdopted?: () => void
}) {
  if (await r2ObjectExists(input.rawDocumentsBucket, input.sourceDocument.r2Key)) {
    return input.sourceDocument
  }

  if (!input.uploadedR2Key) {
    return null
  }

  if (!(await r2ObjectExists(input.rawDocumentsBucket, input.uploadedR2Key))) {
    return null
  }

  const result = await input.d1
    .prepare(
      `
        /* invoice-upload:update-source-r2-key */
        UPDATE source_documents
        SET r2_key = ?,
          status = 'uploaded'
        WHERE id = ?
      `,
    )
    .bind(input.uploadedR2Key, input.sourceDocument.sourceDocumentId)
    .run()

  if ((result.meta?.changes ?? 0) !== 1) {
    return null
  }

  input.onUploadedObjectAdopted?.()

  return {
    ...input.sourceDocument,
    r2Key: input.uploadedR2Key,
  }
}

async function r2ObjectExists(bucket: R2Bucket, r2Key: string) {
  return (await bucket.head(r2Key)) !== null
}

async function markQueuedDuplicateRecoveryFailed(input: {
  db: NonNullable<ReturnType<typeof getDb>>
  sourceDocumentId: string
  jobId: string
  error: unknown
}) {
  const now = new Date().toISOString()
  const errorMessage =
    input.error instanceof Error ? input.error.message : 'Upload pipeline failed'

  await Promise.allSettled([
    input.db
      .update(intakeJobs)
      .set({
        stage: 'error',
        errorMessage,
        updatedAt: now,
      })
      .where(and(eq(intakeJobs.id, input.jobId), eq(intakeJobs.stage, 'queued'))),
    input.db
      .update(sourceDocuments)
      .set({
        status: 'error',
      })
      .where(eq(sourceDocuments.id, input.sourceDocumentId)),
  ])
}

function isContentHashUniqueConstraintError(error: unknown) {
  let current: unknown = error

  while (current instanceof Error) {
    if (
      current.message.includes('source_documents.content_hash') &&
      /unique|constraint/i.test(current.message)
    ) {
      return true
    }

    current = current.cause
  }

  return false
}

function buildRawDocumentKey(input: {
  sourceDocumentId: string
  uploadedAt: string
  fileName: string
}) {
  const [year, month] = input.uploadedAt.slice(0, 7).split('-')
  const sanitizedName = input.fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `raw-documents/${year}/${month}/${input.sourceDocumentId}-${sanitizedName}`
}

async function recoverFailedUpload(input: {
  db: NonNullable<ReturnType<typeof getDb>>
  rawDocumentsBucket: R2Bucket
  r2Key: string
  sourceDocumentId: string
  jobId: string
  objectStored: boolean
  sourceDocumentStored: boolean
  intakeJobStored: boolean
  error: unknown
}) {
  const now = new Date().toISOString()
  const errorMessage =
    input.error instanceof Error ? input.error.message : 'Upload pipeline failed'

  if (input.intakeJobStored) {
    await Promise.allSettled([
      input.db
        .update(intakeJobs)
        .set({
          stage: 'error',
          errorMessage,
          updatedAt: now,
        })
        .where(eq(intakeJobs.id, input.jobId)),
      input.sourceDocumentStored
        ? input.db
            .update(sourceDocuments)
            .set({
              status: 'error',
            })
            .where(eq(sourceDocuments.id, input.sourceDocumentId))
        : Promise.resolve(),
    ])

    return
  }

  if (input.sourceDocumentStored) {
    await Promise.allSettled([
      input.db
        .delete(sourceDocuments)
        .where(eq(sourceDocuments.id, input.sourceDocumentId)),
      input.objectStored ? input.rawDocumentsBucket.delete(input.r2Key) : Promise.resolve(),
    ])

    return
  }

  if (input.objectStored) {
    await Promise.allSettled([input.rawDocumentsBucket.delete(input.r2Key)])
  }
}
