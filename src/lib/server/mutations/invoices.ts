import {
  getInvoiceReadinessSummary,
  type InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  createStoredInvoiceJob,
  upsertStoredInvoiceJob,
} from '@/lib/server/demo-data'

export async function createInvoiceIntakeJob(fileName: string) {
  return createStoredInvoiceJob(fileName)
}

export async function saveInvoiceReviewJob(job: InvoiceReviewJob) {
  return upsertStoredInvoiceJob(job)
}

export async function confirmInvoiceReviewJob(job: InvoiceReviewJob) {
  const readinessSummary = getInvoiceReadinessSummary(job)
  if (!readinessSummary.isReady) {
    return {
      ok: false,
      job: upsertStoredInvoiceJob(job),
      readinessSummary,
    }
  }

  return {
    ok: true,
    job: upsertStoredInvoiceJob(job),
    readinessSummary,
  }
}
