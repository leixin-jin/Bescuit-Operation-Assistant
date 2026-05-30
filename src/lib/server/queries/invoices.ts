import {
  formatInvoiceTimestamp,
  getInvoiceReadinessSummary,
  getInvoiceStatusLabel,
  type InvoiceReviewJob,
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
  return withFallbackPriceComparisons(getStoredInvoiceJob(jobId) ?? null)
}

export async function getInvoiceReviewPageData(jobId: string) {
  return {
    job: withFallbackPriceComparisons(getStoredInvoiceJob(jobId) ?? null),
    ingredientOptions: demoIngredientOptions,
  }
}

function withFallbackPriceComparisons(job: InvoiceReviewJob | null) {
  if (!job) {
    return null
  }

  return {
    ...job,
    lineItems: job.lineItems.map((item) => ({
      ...item,
      priceComparison:
        item.excludeFromPriceTracking === true
          ? { status: 'excluded' as const }
          : (item.priceComparison ?? { status: 'first_record' as const }),
    })),
  }
}
