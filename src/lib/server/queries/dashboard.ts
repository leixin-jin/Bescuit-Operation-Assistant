import { getMadridTodayInputValue } from '@/lib/server/app-domain'
import { formatInvoiceTimestamp } from '@/lib/server/app-domain'
import {
  listStoredInvoiceJobs,
  listStoredSalesRecords,
  listSubmittedSalesRecords,
} from '@/lib/server/fallback-store'
import { getCalendarAnalyticsSummary } from '@/lib/server/queries/analytics'

export async function getDashboardSummary() {
  const today = getMadridTodayInputValue()
  const currentMonth = today.slice(0, 7)
  const monthSummary = await getCalendarAnalyticsSummary(currentMonth)
  const invoiceJobs = listStoredInvoiceJobs()
  const salesRecords = listStoredSalesRecords()
  const submittedSalesRecords = listSubmittedSalesRecords()
  const latestSales = salesRecords[0]
  const latestInvoice = invoiceJobs[0]
  const latestActivityAt = [latestSales?.updatedAt, latestInvoice?.uploadedAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0]

  return {
    todayLabel: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      timeZone: 'Europe/Madrid',
    }).format(new Date()),
    salesRecordedToday: submittedSalesRecords.some((record) => record.date === today),
    pendingInvoiceCount: invoiceJobs.filter((job) => job.status !== 'ready').length,
    monthlyInvoiceCount: invoiceJobs.filter((job) => job.header.date.startsWith(currentMonth))
      .length,
    monthlyExpenseTotal: monthSummary.totalExpense,
    lastActivityLabel: latestActivityAt
      ? `${formatInvoiceTimestamp(latestActivityAt)} 更新`
      : '尚无操作记录',
  }
}
