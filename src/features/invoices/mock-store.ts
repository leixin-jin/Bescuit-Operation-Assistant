import {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceStatusLabel,
  ingredientOptions,
} from '@/lib/server/queries/invoices'
import type {
  IngredientOption,
  InvoiceHeaderDraft,
  InvoiceJobStatus,
  InvoiceLineItemDraft,
  InvoiceReadinessSummary,
  InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  createInvoiceIntakeJob,
  saveInvoiceReviewJob,
} from '@/lib/server/mutations/invoices'
import {
  getInvoiceJob,
  listInvoiceJobs,
} from '@/lib/server/queries/invoices'

export type {
  IngredientOption,
  InvoiceHeaderDraft,
  InvoiceJobStatus,
  InvoiceLineItemDraft,
  InvoiceReadinessSummary,
  InvoiceReviewJob,
}

export { formatInvoiceTimestamp, getInvoiceReadinessSummary, ingredientOptions }

export async function createInvoiceJob(fileName: string) {
  return createInvoiceIntakeJob(fileName)
}

export async function saveInvoiceJob(job: InvoiceReviewJob) {
  return saveInvoiceReviewJob(job)
}

export { getInvoiceStatusLabel as getStatusLabel, getInvoiceJob, listInvoiceJobs }
