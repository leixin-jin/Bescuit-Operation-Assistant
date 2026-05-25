import {
  getInvoiceReadinessSummary,
  type InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  createStoredInvoiceJob,
  deleteStoredInvoiceJob,
  getStoredInvoiceJob,
  upsertStoredInvoiceJob,
} from '@/lib/server/demo-data'

export async function createInvoiceIntakeJob(fileName: string) {
  return createStoredInvoiceJob(fileName)
}

export async function saveInvoiceReviewJob(job: InvoiceReviewJob) {
  return upsertStoredInvoiceJob(job)
}

export async function recheckInvoiceReviewJob(jobId: string) {
  const job = getStoredInvoiceJob(jobId)
  if (!job) {
    throw new Error('未找到发票任务，不能重新核对。')
  }

  return upsertStoredInvoiceJob({
    ...job,
    status: 'needs_review',
    stage: 'needs_review',
    errorMessage: null,
  })
}

export async function deleteInvoiceIntakeJob(jobId: string) {
  return deleteStoredInvoiceJob(jobId)
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
