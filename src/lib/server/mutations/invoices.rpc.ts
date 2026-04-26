import { desc, eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'

import { validateInvoiceUpload } from '@/features/invoices/intake-file-validation'
import { getDb } from '@/lib/db/client'
import { extractionResults, intakeJobs } from '@/lib/db/schema'
import type { InvoiceReviewJob } from '@/lib/server/app-domain'
import { getInvoiceReadinessSummary } from '@/lib/server/fallback-store'
import {
  mapIntakeStageToInvoiceStatus,
  parseStoredExtractionDraft,
  serializeExtractionDraft,
  type InvoiceExtractionDraft,
} from '@/lib/server/extraction'
import type { AppBindings } from '@/lib/server/bindings'
import { uploadInvoiceSourceDocument } from '@/lib/server/upload'

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
    return uploadInvoiceSourceDocument({
      env: context.env,
      file,
      uploadedBy,
    })
  })

export const saveInvoiceReviewJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { job: InvoiceReviewJob }) => data)
  .handler(async ({ data, context }) =>
    persistInvoiceReviewDraft(context.env, data.job, 'needs_review'),
  )

export const confirmInvoiceReviewJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { job: InvoiceReviewJob }) => data)
  .handler(async ({ data, context }) => {
    const readinessSummary = getInvoiceReadinessSummary(data.job)

    if (!readinessSummary.isReady) {
      const job = await persistInvoiceReviewDraft(
        context.env,
        data.job,
        'needs_review',
      )

      return {
        ok: false,
        job,
        readinessSummary,
      }
    }

    const job = await persistInvoiceReviewDraft(context.env, data.job, 'ready')

    return {
      ok: true,
      job,
      readinessSummary,
    }
  })

async function persistInvoiceReviewDraft(
  env: AppBindings,
  job: InvoiceReviewJob,
  nextStage: 'needs_review' | 'ready',
) {
  const db = getDb(env)

  if (!db) {
    throw new Error('Missing Cloudflare binding: DB')
  }

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
  const existingResultId = await getLatestExtractionResultId(db, job.jobId)
  const now = new Date().toISOString()

  if (existingResultId) {
    await db
      .update(extractionResults)
      .set({
        structuredJson: serializeExtractionDraft(nextDraft),
        markdownText: nextDraft.markdownText,
        rawResponse: JSON.stringify({
          source: 'manual-review',
          updatedAt: now,
        }),
      })
      .where(eq(extractionResults.id, existingResultId))
  } else {
    await db.insert(extractionResults).values({
      id: `ext_${crypto.randomUUID()}`,
      intakeJobId: job.jobId,
      markdownText: nextDraft.markdownText,
      structuredJson: serializeExtractionDraft(nextDraft),
      rawResponse: JSON.stringify({
        source: 'manual-review',
        createdAt: now,
      }),
      schemaVersion: 'invoice-extraction-v1',
      createdAt: now,
    })
  }

  await db
    .update(intakeJobs)
    .set({
      stage: nextStage,
      errorMessage: null,
      updatedAt: now,
    })
    .where(eq(intakeJobs.id, job.jobId))

  return {
    ...job,
    stage: nextStage,
    errorMessage: null,
    lineItems: nextLineItems,
    status: mapIntakeStageToInvoiceStatus(nextStage),
  }
}

async function getLatestExtractionDraft(
  db: NonNullable<ReturnType<typeof getDb>>,
  jobId: string,
  fileName: string,
) {
  const [latestExtractionResult] = await db
    .select({
      structuredJson: extractionResults.structuredJson,
    })
    .from(extractionResults)
    .where(eq(extractionResults.intakeJobId, jobId))
    .orderBy(desc(extractionResults.createdAt))
    .limit(1)

  return parseStoredExtractionDraft(latestExtractionResult?.structuredJson, fileName)
}

async function getLatestExtractionResultId(
  db: NonNullable<ReturnType<typeof getDb>>,
  jobId: string,
) {
  const [latestExtractionResult] = await db
    .select({
      id: extractionResults.id,
    })
    .from(extractionResults)
    .where(eq(extractionResults.intakeJobId, jobId))
    .orderBy(desc(extractionResults.createdAt))
    .limit(1)

  return latestExtractionResult?.id ?? null
}
