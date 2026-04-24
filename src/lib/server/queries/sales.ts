import {
  getMadridTodayInputValue,
  paymentChannels,
  type SalesDailyRecord,
} from '@/lib/server/app-domain'
import { getStoredSalesRecord, listStoredSalesRecords } from '@/lib/server/fallback-store'

export async function getSalesEntryPageData(date = getMadridTodayInputValue()) {
  return {
    date,
    paymentChannels,
    existingRecord: getStoredSalesRecord(date) ?? null,
  }
}

export async function getSalesRecord(date: string) {
  return getStoredSalesRecord(date) ?? null
}

export async function listRecentSalesRecords(limit = 7): Promise<SalesDailyRecord[]> {
  return listStoredSalesRecords().slice(0, limit)
}
