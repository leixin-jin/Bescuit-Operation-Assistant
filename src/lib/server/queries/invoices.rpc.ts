import { desc, eq, inArray } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'

import { getDb } from '@/lib/db/client'
import { extractionResults, intakeJobs, sourceDocuments } from '@/lib/db/schema'
import type { InvoiceReviewJob } from '@/lib/server/app-domain'
import {
  buildInvoiceReviewJob,
  createPendingExtractionDraft,
  serializeExtractionDraft,
} from '@/lib/server/extraction'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { hasInvoiceIntakePipelineSchema } from '@/lib/server/pipeline-readiness'
import { listIngredientOptions } from '@/lib/server/queries/ingredients'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

export const getInvoicePipelineEnabled = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => {
    const env = getServerEnv(context)
    const pipelineEnabled = await hasInvoiceIntakePipelineSchema(env)

    if (!pipelineEnabled) {
      assertDemoDataEnabled(env, 'invoice intake pipeline')
    }

    return pipelineEnabled
  },
)

export const listInvoiceJobsServerFn = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => listInvoiceJobsFromDatabase(getServerEnv(context)),
)

export const getInvoiceReviewPageDataServerFn = createServerFn({
  method: 'GET',
})
  .inputValidator((data: { jobId: string }) => data)
  .handler(async ({ data, context }) => {
    const env = getServerEnv(context)
    const job = await getInvoiceJobFromDatabase(env, data.jobId)

    return {
      job,
      ingredientOptions: await listIngredientOptions(env),
    }
  })

async function listInvoiceJobsFromDatabase(
  env: Partial<AppBindings> | null | undefined,
) {
  const db = getDb(env)

  if (!db) {
    return [] satisfies InvoiceReviewJob[]
  }

  const jobRows = await db
    .select({
      jobId: intakeJobs.id,
      stage: intakeJobs.stage,
      errorMessage: intakeJobs.errorMessage,
      fileName: sourceDocuments.originalFilename,
      uploadedAt: sourceDocuments.uploadedAt,
    })
    .from(intakeJobs)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, intakeJobs.sourceDocumentId))
    .orderBy(desc(sourceDocuments.uploadedAt))

  if (jobRows.length === 0) {
    return [] satisfies InvoiceReviewJob[]
  }

  const latestExtractionByJobId = await getLatestExtractionMap(
    db,
    jobRows.map((row) => row.jobId),
  )

  return jobRows.map((row) =>
    buildInvoiceReviewJob({
      jobId: row.jobId,
      fileName: row.fileName,
      uploadedAt: row.uploadedAt,
      stage: row.stage,
      errorMessage: row.errorMessage,
      structuredJson:
        latestExtractionByJobId.get(row.jobId) ??
        serializeExtractionDraft(createPendingExtractionDraft(row.fileName)),
    }),
  )
}

async function getInvoiceJobFromDatabase(
  env: Partial<AppBindings> | null | undefined,
  jobId: string,
) {
  const db = getDb(env)

  if (!db) {
    return null
  }

  const [jobRow] = await db
    .select({
      jobId: intakeJobs.id,
      stage: intakeJobs.stage,
      errorMessage: intakeJobs.errorMessage,
      fileName: sourceDocuments.originalFilename,
      uploadedAt: sourceDocuments.uploadedAt,
    })
    .from(intakeJobs)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, intakeJobs.sourceDocumentId))
    .where(eq(intakeJobs.id, jobId))
    .limit(1)

  if (!jobRow) {
    return null
  }

  const latestExtractionByJobId = await getLatestExtractionMap(db, [jobId])

  return buildInvoiceReviewJob({
    jobId: jobRow.jobId,
    fileName: jobRow.fileName,
    uploadedAt: jobRow.uploadedAt,
    stage: jobRow.stage,
    errorMessage: jobRow.errorMessage,
    structuredJson:
      latestExtractionByJobId.get(jobId) ??
      serializeExtractionDraft(createPendingExtractionDraft(jobRow.fileName)),
  })
}

async function getLatestExtractionMap(
  db: NonNullable<ReturnType<typeof getDb>>,
  jobIds: string[],
) {
  const extractionRows =
    jobIds.length > 0
      ? await db
          .select({
            jobId: extractionResults.intakeJobId,
            structuredJson: extractionResults.structuredJson,
            createdAt: extractionResults.createdAt,
          })
          .from(extractionResults)
          .where(inArray(extractionResults.intakeJobId, jobIds))
          .orderBy(desc(extractionResults.createdAt))
      : []

  const latestExtractionByJobId = new Map<string, string | null>()

  for (const extractionRow of extractionRows) {
    if (!latestExtractionByJobId.has(extractionRow.jobId)) {
      latestExtractionByJobId.set(extractionRow.jobId, extractionRow.structuredJson)
    }
  }

  return latestExtractionByJobId
}
