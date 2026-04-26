import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db/client'
import { intakeJobs, sourceDocuments } from '@/lib/db/schema'
import type { AppBindings } from '@/lib/server/bindings'
import { requireBinding } from '@/lib/server/bindings'
import { enqueueInvoiceIntakeJob } from '@/lib/server/queue'

export interface InvoiceUploadResult {
  jobId: string
  sourceDocumentId: string
  r2Key: string
}

export async function uploadInvoiceSourceDocument(input: {
  env: AppBindings
  file: File
  uploadedBy?: string | null
}) {
  const db = getDb(input.env)
  const rawDocumentsBucket = requireBinding(input.env.RAW_DOCUMENTS, 'RAW_DOCUMENTS')

  if (!db) {
    throw new Error('Missing Cloudflare binding: DB')
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
      uploadedBy: input.uploadedBy ?? null,
      status: 'uploaded',
      uploadedAt,
    })
    sourceDocumentStored = true

    await db.insert(intakeJobs).values({
      id: jobId,
      sourceDocumentId,
      extractorProvider: input.env.AI ? 'workers-ai' : 'heuristic',
      extractorModel: input.env.AI ? 'to-markdown' : 'filename-fallback-v1',
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

    throw error
  }

  return {
    jobId,
    sourceDocumentId,
    r2Key,
  } satisfies InvoiceUploadResult
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
