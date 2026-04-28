import {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceStatusLabel,
} from '@/lib/server/app-domain'
import {
  demoIngredientOptions,
  getStoredInvoiceJob,
  listStoredInvoiceJobs,
} from '@/lib/server/demo-data'

export {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceStatusLabel,
}

export const ingredientOptions = demoIngredientOptions

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
    ingredientOptions: demoIngredientOptions,
  }
}
