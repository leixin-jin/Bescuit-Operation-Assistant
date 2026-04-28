import { createServerFn } from '@tanstack/react-start'

import type { DashboardSummary } from '@/lib/server/app-domain'
import {
  formatInvoiceTimestamp,
  getMadridTodayInputValue,
} from '@/lib/server/app-domain'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, firstD1, requireD1Database } from '@/lib/server/d1'
import {
  listStoredInvoiceJobs,
  listStoredSalesRecords,
} from '@/lib/server/demo-data'
import {
  getCalendarAnalyticsSummary,
  getCalendarAnalyticsSummaryFromDatabase,
} from '@/lib/server/queries/analytics'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

interface CountRow {
  count: number
}

interface LastActivityRow {
  lastActivityAt: string | null
}

export const getDashboardSummaryServerFn = createServerFn({
  method: 'GET',
})
  .inputValidator((data: Record<string, never> | undefined) => data ?? {})
  .handler(async ({ context }) => getDashboardSummary(getServerEnv(context)))

export async function getDashboardSummary(
  env?: Partial<AppBindings> | null,
): Promise<DashboardSummary> {
  if (!env?.DB) {
    assertDemoDataEnabled(env, 'dashboard')
    return getDemoDashboardSummary()
  }

  return getDashboardSummaryFromDatabase(env)
}

export async function getDashboardSummaryFromDatabase(
  env: Partial<AppBindings>,
): Promise<DashboardSummary> {
  const db = requireD1Database(env, 'dashboard')
  const today = getMadridTodayInputValue()
  const currentMonth = today.slice(0, 7)
  const { startDate, endDate } = getMonthRange(currentMonth)
  const [todaySales, pendingInvoiceRows, monthlyInvoiceRows, monthSummary, lastActivity] =
    await Promise.all([
      firstD1<CountRow>(
        db,
        `/* dashboard:today-sales */
        SELECT COUNT(*) AS count
        FROM sales_daily
        WHERE date = ?
          AND status = 'submitted'`,
        [today],
      ),
      allD1<CountRow>(
        db,
        `/* dashboard:pending-invoices */
        SELECT COUNT(*) AS count
        FROM intake_jobs
        WHERE stage != 'ready'`,
      ),
      allD1<CountRow>(
        db,
        `/* dashboard:monthly-invoices */
        SELECT COUNT(*) AS count
        FROM invoices
        WHERE invoice_date >= ?
          AND invoice_date < ?`,
        [startDate, endDate],
      ),
      getCalendarAnalyticsSummaryFromDatabase(env, currentMonth),
      firstD1<LastActivityRow>(
        db,
        `/* dashboard:last-activity */
        SELECT MAX(activity_at) AS lastActivityAt
        FROM (
          SELECT updated_at AS activity_at FROM sales_daily
          UNION ALL
          SELECT uploaded_at AS activity_at FROM source_documents
          UNION ALL
          SELECT updated_at AS activity_at FROM intake_jobs
          UNION ALL
          SELECT updated_at AS activity_at FROM invoices
        )`,
      ),
    ])

  return {
    todayLabel: getTodayLabel(),
    salesRecordedToday: (todaySales?.count ?? 0) > 0,
    pendingInvoiceCount: pendingInvoiceRows[0]?.count ?? 0,
    monthlyInvoiceCount: monthlyInvoiceRows[0]?.count ?? 0,
    monthlyExpenseTotal: monthSummary.totalExpense,
    lastActivityLabel: lastActivity?.lastActivityAt
      ? `${formatInvoiceTimestamp(lastActivity.lastActivityAt)} 更新`
      : '尚无操作记录',
  }
}

async function getDemoDashboardSummary() {
  const today = getMadridTodayInputValue()
  const currentMonth = today.slice(0, 7)
  const monthSummary = await getCalendarAnalyticsSummary(currentMonth)
  const invoiceJobs = listStoredInvoiceJobs()
  const salesRecords = listStoredSalesRecords()
  const latestSales = salesRecords[0]
  const latestInvoice = invoiceJobs[0]
  const latestActivityAt = [latestSales?.updatedAt, latestInvoice?.uploadedAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0]

  return {
    todayLabel: getTodayLabel(),
    salesRecordedToday: salesRecords.some(
      (record) => record.status === 'submitted' && record.date === today,
    ),
    pendingInvoiceCount: invoiceJobs.filter((job) => job.status !== 'ready').length,
    monthlyInvoiceCount: invoiceJobs.filter((job) => job.header.date.startsWith(currentMonth))
      .length,
    monthlyExpenseTotal: monthSummary.totalExpense,
    lastActivityLabel: latestActivityAt
      ? `${formatInvoiceTimestamp(latestActivityAt)} 更新`
      : '尚无操作记录',
  }
}

function getTodayLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Europe/Madrid',
  }).format(new Date())
}

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split('-').map((value) => Number.parseInt(value, 10))
  const nextMonthDate = new Date(year, monthNumber, 1, 12)

  return {
    startDate: `${month}-01`,
    endDate: [
      nextMonthDate.getFullYear().toString(),
      String(nextMonthDate.getMonth() + 1).padStart(2, '0'),
      '01',
    ].join('-'),
  }
}
