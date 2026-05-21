import { and, eq } from 'drizzle-orm'

import { getDb } from '@/lib/db/client'
import { intakeJobs, sourceDocuments } from '@/lib/db/schema'
import type { AppBindings } from '@/lib/server/bindings'
import { requireBinding } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
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

    const provider = selectInvoiceExtractionProvider(input.env)

    await db.insert(intakeJobs).values({
      id: jobId,
      sourceDocumentId,
      extractorProvider: provider.id,
      extractorModel: provider.model,
      stage: 'queued',
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    })
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
    await recoverFailedUpload({
      db,
      rawDocumentsBucket,
      r2Key,
      sourceDocumentId,
      jobId,
      objectStored,
      sourceDocumentStored,
      intakeJobStored,
      error,
    })

    const recoveredDuplicate = await recoverDuplicateUploadConflict({
      env: input.env,
      db,
      d1,
      contentHash,
      error,
    })

    if (recoveredDuplicate) {
      return recoveredDuplicate
    }

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
  contentHash: string
  error: unknown
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

  return createQueuedInvoiceJobForExistingSource({
    env: input.env,
    db: input.db,
    sourceDocument: {
      ...existingSourceDocument,
      r2Key: existingSourceDocument.r2Key,
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

async function createQueuedInvoiceJobForExistingSource(input: {
  env: AppBindings
  db: NonNullable<ReturnType<typeof getDb>>
  sourceDocument: ExistingInvoiceSourceDocumentRow & { r2Key: string }
}) {
  const jobId = `job_${crypto.randomUUID()}`
  const queuedAt = new Date().toISOString()
  const provider = selectInvoiceExtractionProvider(input.env)
  const mimeType = input.sourceDocument.mimeType || 'application/octet-stream'

  await input.db.insert(intakeJobs).values({
    id: jobId,
    sourceDocumentId: input.sourceDocument.sourceDocumentId,
    extractorProvider: provider.id,
    extractorModel: provider.model,
    stage: 'queued',
    createdAt: queuedAt,
    updatedAt: queuedAt,
  })

  await input.db
    .update(sourceDocuments)
    .set({
      status: 'uploaded',
    })
    .where(eq(sourceDocuments.id, input.sourceDocument.sourceDocumentId))

  try {
    await enqueueInvoiceIntakeJob(input.env, {
      jobId,
      sourceDocumentId: input.sourceDocument.sourceDocumentId,
      r2Key: input.sourceDocument.r2Key,
      fileName: input.sourceDocument.fileName,
      mimeType,
      uploadedAt: input.sourceDocument.uploadedAt,
    })
  } catch (error) {
    await markQueuedDuplicateRecoveryFailed({
      db: input.db,
      sourceDocumentId: input.sourceDocument.sourceDocumentId,
      jobId,
      error,
    })

    throw error
  }

  return {
    jobId,
    sourceDocumentId: input.sourceDocument.sourceDocumentId,
    r2Key: input.sourceDocument.r2Key,
  } satisfies InvoiceUploadResult
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
    await input.rawDocumentsBucket.delete(input.r2Key)
  }
}
