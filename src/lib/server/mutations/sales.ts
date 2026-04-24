import type { SalesDailyDraftInput } from '@/lib/server/app-domain'
import { upsertStoredSalesRecord } from '@/lib/server/fallback-store'

export async function saveSalesDraft(input: SalesDailyDraftInput) {
  return upsertStoredSalesRecord(input, 'draft')
}

export async function submitSalesEntry(input: SalesDailyDraftInput) {
  return upsertStoredSalesRecord(input, 'submitted')
}
