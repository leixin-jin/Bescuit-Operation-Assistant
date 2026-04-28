import { createServerFn } from '@tanstack/react-start'

import type {
  CalendarAnalyticsSummary,
  CalendarDaySummary,
  MonthlyAnalyticsSummary,
  SalesDailyRecord,
} from '@/lib/server/app-domain'
import {
  getMadridTodayInputValue,
  getMonthOptions,
  roundCurrency,
} from '@/lib/server/app-domain'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
import { listStoredSalesRecords } from '@/lib/server/demo-data'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

interface SalesAnalyticsRow {
  id: string
  date: string
  totalAmount: number
  bbvaAmount: number
  caixaAmount: number
  cashAmount: number
  status: string
  note: string
  updatedAt: string
}

interface ExpenseAnalyticsRow {
  entryDate: string
  category: string
  amount: number
}

export const getCalendarAnalyticsSummaryServerFn = createServerFn({
  method: 'GET',
})
  .inputValidator((data: { month?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }) =>
    getCalendarAnalyticsSummary(getServerEnv(context), data?.month),
  )

export const getMonthlyAnalyticsSummaryServerFn = createServerFn({
  method: 'GET',
})
  .inputValidator((data: { month?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }) =>
    getMonthlyAnalyticsSummary(getServerEnv(context), data?.month),
  )

export async function getCalendarAnalyticsSummary(
  envOrMonth?: Partial<AppBindings> | string | null,
  maybeMonth?: string,
): Promise<CalendarAnalyticsSummary> {
  const { env, month } = resolveAnalyticsArgs(envOrMonth, maybeMonth)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'analytics')
    return getDemoCalendarAnalyticsSummary(month)
  }

  return getCalendarAnalyticsSummaryFromDatabase(env, month)
}

export async function getMonthlyAnalyticsSummary(
  envOrMonth?: Partial<AppBindings> | string | null,
  maybeMonth?: string,
): Promise<MonthlyAnalyticsSummary> {
  const { env, month } = resolveAnalyticsArgs(envOrMonth, maybeMonth)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'analytics')
    return getDemoMonthlyAnalyticsSummary(month)
  }

  return getMonthlyAnalyticsSummaryFromDatabase(env, month)
}

export async function getCalendarAnalyticsSummaryFromDatabase(
  env: Partial<AppBindings>,
  selectedMonth = getMadridTodayInputValue().slice(0, 7),
): Promise<CalendarAnalyticsSummary> {
  const [salesRows, expenseRows] = await Promise.all([
    listSubmittedSalesRowsForMonth(env, selectedMonth),
    listExpenseRowsForMonth(env, selectedMonth),
  ])
  const daySummaries = buildCalendarDaySummaries(salesRows, expenseRows)
  const { income, expense } = sumCalendarDaySummaries(daySummaries)

  return {
    selectedMonth,
    monthName: toMonthDate(selectedMonth).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
    }),
    monthOptions: getMonthOptions(selectedMonth),
    days: daySummaries,
    totalIncome: income,
    totalExpense: expense,
  }
}

export async function getMonthlyAnalyticsSummaryFromDatabase(
  env: Partial<AppBindings>,
  selectedMonth = getMadridTodayInputValue().slice(0, 7),
): Promise<MonthlyAnalyticsSummary> {
  const [currentMonth, previousMonth, salesRows, expenseRows] = await Promise.all([
    getCalendarAnalyticsSummaryFromDatabase(env, selectedMonth),
    getCalendarAnalyticsSummaryFromDatabase(env, shiftMonth(selectedMonth, -1)),
    listSubmittedSalesRowsForMonth(env, selectedMonth),
    listExpenseRowsForMonth(env, selectedMonth),
  ])

  return buildMonthlyAnalyticsSummary({
    selectedMonth,
    currentMonth,
    previousMonth,
    incomeBreakdown: buildIncomeBreakdown(salesRows),
    expenseBreakdown: buildExpenseBreakdown(expenseRows),
  })
}

async function listSubmittedSalesRowsForMonth(
  env: Partial<AppBindings>,
  month: string,
) {
  const db = requireD1Database(env, 'analytics')
  const { startDate, endDate } = getMonthRange(month)

  return allD1<SalesAnalyticsRow>(
    db,
    `/* analytics:sales-month */
    SELECT
      id,
      date,
      total_amount AS totalAmount,
      bbva_amount AS bbvaAmount,
      caixa_amount AS caixaAmount,
      cash_amount AS cashAmount,
      status,
      note,
      updated_at AS updatedAt
    FROM sales_daily
    WHERE status = 'submitted'
      AND date >= ?
      AND date < ?
    ORDER BY date ASC`,
    [startDate, endDate],
  )
}

async function listExpenseRowsForMonth(env: Partial<AppBindings>, month: string) {
  const db = requireD1Database(env, 'analytics')
  const { startDate, endDate } = getMonthRange(month)

  return allD1<ExpenseAnalyticsRow>(
    db,
    `/* analytics:expenses-month */
    SELECT
      entry_date AS entryDate,
      category,
      amount
    FROM ledger_entries
    WHERE entry_type = 'expense'
      AND entry_date >= ?
      AND entry_date < ?
    ORDER BY entry_date ASC`,
    [startDate, endDate],
  )
}

function buildMonthlyAnalyticsSummary(input: {
  selectedMonth: string
  currentMonth: CalendarAnalyticsSummary
  previousMonth: CalendarAnalyticsSummary
  incomeBreakdown: Array<{ name: string; value: number }>
  expenseBreakdown: Array<{ name: string; value: number }>
}) {
  const { currentMonth, previousMonth } = input

  return {
    selectedMonth: input.selectedMonth,
    monthOptions: currentMonth.monthOptions,
    incomeBreakdown: toPercentageBreakdown(input.incomeBreakdown),
    expenseBreakdown: toPercentageBreakdown(input.expenseBreakdown),
    weeklyTrend: buildWeeklyTrend(currentMonth.days),
    totalIncome: currentMonth.totalIncome,
    totalExpense: currentMonth.totalExpense,
    totalNet: roundCurrency(currentMonth.totalIncome - currentMonth.totalExpense),
    profitMargin:
      currentMonth.totalIncome === 0
        ? 0
        : roundCurrency(
            ((currentMonth.totalIncome - currentMonth.totalExpense) /
              currentMonth.totalIncome) *
              100,
          ),
    incomeTrend: getTrend(currentMonth.totalIncome, previousMonth.totalIncome),
    expenseTrend: getTrend(currentMonth.totalExpense, previousMonth.totalExpense),
    netTrend: getTrend(
      currentMonth.totalIncome - currentMonth.totalExpense,
      previousMonth.totalIncome - previousMonth.totalExpense,
    ),
    marginDelta: roundCurrency(
      getProfitMargin(currentMonth) - getProfitMargin(previousMonth),
    ),
  }
}

function buildCalendarDaySummaries(
  salesRows: SalesAnalyticsRow[],
  expenseRows: ExpenseAnalyticsRow[],
) {
  const daySummaries: Record<string, CalendarDaySummary> = {}

  for (const row of salesRows) {
    const dayKey = getDayKey(row.date)
    const currentSummary = daySummaries[dayKey] ?? { income: 0, expense: 0 }
    daySummaries[dayKey] = {
      income: roundCurrency(currentSummary.income + row.totalAmount),
      expense: currentSummary.expense,
    }
  }

  for (const row of expenseRows) {
    const dayKey = getDayKey(row.entryDate)
    const currentSummary = daySummaries[dayKey] ?? { income: 0, expense: 0 }
    daySummaries[dayKey] = {
      income: currentSummary.income,
      expense: roundCurrency(currentSummary.expense + row.amount),
    }
  }

  return daySummaries
}

function buildIncomeBreakdown(salesRows: SalesAnalyticsRow[]) {
  return [
    {
      name: 'BBVA',
      value: roundCurrency(
        salesRows.reduce((sum, row) => sum + row.bbvaAmount, 0),
      ),
    },
    {
      name: 'CAIXA',
      value: roundCurrency(
        salesRows.reduce((sum, row) => sum + row.caixaAmount, 0),
      ),
    },
    {
      name: 'EFECTIVO',
      value: roundCurrency(
        salesRows.reduce((sum, row) => sum + row.cashAmount, 0),
      ),
    },
  ]
}

function buildExpenseBreakdown(expenseRows: ExpenseAnalyticsRow[]) {
  const totalsByCategory = new Map<string, number>()

  for (const row of expenseRows) {
    totalsByCategory.set(
      row.category,
      roundCurrency((totalsByCategory.get(row.category) ?? 0) + row.amount),
    )
  }

  return Array.from(totalsByCategory.entries()).map(([name, value]) => ({
    name,
    value,
  }))
}

function buildWeeklyTrend(days: Record<string, CalendarDaySummary>) {
  const buckets = new Map<number, { income: number; expense: number }>()

  for (const [day, summary] of Object.entries(days)) {
    const week = Math.ceil(Number.parseInt(day, 10) / 7)
    const currentBucket = buckets.get(week) ?? { income: 0, expense: 0 }
    currentBucket.income += summary.income
    currentBucket.expense += summary.expense
    buckets.set(week, currentBucket)
  }

  return Array.from(buckets.entries()).map(([week, totals]) => ({
    week: `第${week}周`,
    income: roundCurrency(totals.income),
    expense: roundCurrency(totals.expense),
  }))
}

function sumCalendarDaySummaries(days: Record<string, CalendarDaySummary>) {
  return Object.values(days).reduce(
    (accumulator, day) => ({
      income: roundCurrency(accumulator.income + day.income),
      expense: roundCurrency(accumulator.expense + day.expense),
    }),
    { income: 0, expense: 0 },
  )
}

function toPercentageBreakdown(entries: Array<{ name: string; value: number }>) {
  const total = entries.reduce((sum, item) => sum + item.value, 0)

  return entries.map((item) => ({
    ...item,
    percentage: total === 0 ? 0 : roundCurrency((item.value / total) * 100),
  }))
}

function getTrend(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : 100
  }

  return roundCurrency(((currentValue - previousValue) / previousValue) * 100)
}

function getProfitMargin(summary: Pick<CalendarAnalyticsSummary, 'totalIncome' | 'totalExpense'>) {
  return summary.totalIncome === 0
    ? 0
    : ((summary.totalIncome - summary.totalExpense) / summary.totalIncome) * 100
}

function shiftMonth(month: string, offset: number) {
  const date = toMonthDate(month)
  date.setMonth(date.getMonth() + offset)
  return [
    date.getFullYear().toString(),
    String(date.getMonth() + 1).padStart(2, '0'),
  ].join('-')
}

function toMonthDate(month: string) {
  const [year, monthNumber] = month.split('-').map((value) => Number.parseInt(value, 10))
  return new Date(year, monthNumber - 1, 1, 12)
}

function getMonthRange(month: string) {
  return {
    startDate: `${month}-01`,
    endDate: `${shiftMonth(month, 1)}-01`,
  }
}

function getDayKey(date: string) {
  return String(Number.parseInt(date.slice(8, 10), 10))
}

function resolveAnalyticsArgs(
  envOrMonth: Partial<AppBindings> | string | null | undefined,
  maybeMonth: string | undefined,
) {
  if (typeof envOrMonth === 'string') {
    return {
      env: undefined,
      month: envOrMonth,
    }
  }

  return {
    env: envOrMonth ?? undefined,
    month: maybeMonth ?? getMadridTodayInputValue().slice(0, 7),
  }
}

async function getDemoCalendarAnalyticsSummary(selectedMonth: string) {
  const salesRows = listStoredSalesRecords()
    .filter((record) => record.status === 'submitted' && record.date.startsWith(selectedMonth))
    .map(toSalesAnalyticsRow)
  const daySummaries = buildCalendarDaySummaries(salesRows, [])
  const { income, expense } = sumCalendarDaySummaries(daySummaries)

  return {
    selectedMonth,
    monthName: toMonthDate(selectedMonth).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
    }),
    monthOptions: getMonthOptions(selectedMonth),
    days: daySummaries,
    totalIncome: income,
    totalExpense: expense,
  }
}

async function getDemoMonthlyAnalyticsSummary(selectedMonth: string) {
  const currentMonth = await getDemoCalendarAnalyticsSummary(selectedMonth)
  const previousMonth = await getDemoCalendarAnalyticsSummary(shiftMonth(selectedMonth, -1))
  const salesRows = listStoredSalesRecords()
    .filter((record) => record.status === 'submitted' && record.date.startsWith(selectedMonth))
    .map(toSalesAnalyticsRow)

  return buildMonthlyAnalyticsSummary({
    selectedMonth,
    currentMonth,
    previousMonth,
    incomeBreakdown: buildIncomeBreakdown(salesRows),
    expenseBreakdown: [],
  })
}

function toSalesAnalyticsRow(record: SalesDailyRecord): SalesAnalyticsRow {
  return {
    id: record.id,
    date: record.date,
    totalAmount: record.totalAmount,
    bbvaAmount: record.bbvaAmount,
    caixaAmount: record.caixaAmount,
    cashAmount: record.cashAmount,
    status: record.status,
    note: record.note,
    updatedAt: record.updatedAt,
  }
}
