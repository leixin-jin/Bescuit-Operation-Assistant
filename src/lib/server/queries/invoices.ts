import {
  formatInvoiceTimestamp,
  getInvoiceStatusLabel,
  ingredientOptions,
} from '@/lib/server/app-domain'
import { getInvoiceReadinessSummary, getStoredInvoiceJob, listStoredInvoiceJobs } from '@/lib/server/fallback-store'

export {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceStatusLabel,
  ingredientOptions,
}

export async function getInvoiceIntakePageData() {
  return {
    recentJobs: listStoredInvoiceJobs(),
  }
}

export async function listInvoiceJobs() {
  return listStoredInvoiceJobs()
}

export async function getInvoiceJob(jobId: string) {
  return getStoredInvoiceJob(jobId) ?? null
}

export async function getInvoiceReviewPageData(jobId: string) {
  return {
    job: getStoredInvoiceJob(jobId) ?? null,
    ingredientOptions,
  }
}
