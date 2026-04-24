import type {
  CalendarAnalyticsSummary,
  CalendarDaySummary,
  MonthlyAnalyticsSummary,
} from '@/lib/server/app-domain'
import { getMadridTodayInputValue } from '@/lib/server/app-domain'
import {
  getApprovedInvoiceTotalsByDay,
  getCalendarMonthBase,
  getMonthOptions,
  listSubmittedSalesRecords,
} from '@/lib/server/fallback-store'

export async function getCalendarAnalyticsSummary(
  selectedMonth = getMadridTodayInputValue().slice(0, 7),
): Promise<CalendarAnalyticsSummary> {
  const daySummaries = buildCalendarDaySummaries(selectedMonth)
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

export async function getMonthlyAnalyticsSummary(
  selectedMonth = getMadridTodayInputValue().slice(0, 7),
): Promise<MonthlyAnalyticsSummary> {
  const currentMonth = await getCalendarAnalyticsSummary(selectedMonth)
  const previousMonth = await getCalendarAnalyticsSummary(
    shiftMonth(selectedMonth, -1),
  )
  const channelTotals = buildIncomeBreakdown(selectedMonth, currentMonth.days)
  const expenseBreakdown = buildExpenseBreakdown(currentMonth.totalExpense)

  return {
    selectedMonth,
    monthOptions: currentMonth.monthOptions,
    incomeBreakdown: toPercentageBreakdown(channelTotals),
    expenseBreakdown: toPercentageBreakdown(expenseBreakdown),
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
      (currentMonth.totalIncome === 0
        ? 0
        : ((currentMonth.totalIncome - currentMonth.totalExpense) /
            currentMonth.totalIncome) *
            100) -
        (previousMonth.totalIncome === 0
          ? 0
          : ((previousMonth.totalIncome - previousMonth.totalExpense) /
              previousMonth.totalIncome) *
              100),
    ),
  }
}

function buildCalendarDaySummaries(month: string) {
  const baseCalendar = getCalendarMonthBase(month)
  const daySummaries: Record<string, CalendarDaySummary> = Object.fromEntries(
    Object.entries(baseCalendar).map(([day, summary]) => [day, { ...summary }]),
  )

  for (const record of listSubmittedSalesRecords()) {
    if (!record.date.startsWith(month)) {
      continue
    }

    const dayKey = String(Number.parseInt(record.date.slice(8, 10), 10))
    daySummaries[dayKey] = {
      income: roundCurrency(record.totalAmount),
      expense: daySummaries[dayKey]?.expense ?? 0,
    }
  }

  for (const [date, total] of getApprovedInvoiceTotalsByDay(month)) {
    const dayKey = String(Number.parseInt(date.slice(8, 10), 10))
    daySummaries[dayKey] = {
      income: daySummaries[dayKey]?.income ?? 0,
      expense: roundCurrency(total),
    }
  }

  return daySummaries
}

function buildIncomeBreakdown(
  month: string,
  daySummaries: Record<string, CalendarDaySummary>,
) {
  const totals = [
    { name: 'BBVA', value: 0 },
    { name: 'CAIXA', value: 0 },
    { name: 'EFECTIVO', value: 0 },
  ]
  const salesByDate = new Map(
    listSubmittedSalesRecords()
      .filter((record) => record.date.startsWith(month))
      .map((record) => [record.date, record]),
  )

  for (const [day, summary] of Object.entries(daySummaries)) {
    const date = `${month}-${day.padStart(2, '0')}`
    const storedRecord = salesByDate.get(date)

    if (storedRecord) {
      totals[0]!.value += storedRecord.bbvaAmount
      totals[1]!.value += storedRecord.caixaAmount
      totals[2]!.value += storedRecord.cashAmount
      continue
    }

    const bbvaAmount = roundCurrency(summary.income * 0.45)
    const caixaAmount = roundCurrency(summary.income * 0.3)
    totals[0]!.value += bbvaAmount
    totals[1]!.value += caixaAmount
    totals[2]!.value += roundCurrency(summary.income - bbvaAmount - caixaAmount)
  }

  return totals.map((item) => ({
    name: item.name,
    value: roundCurrency(item.value),
  }))
}

function buildExpenseBreakdown(totalExpense: number) {
  return [
    { name: '酒水采购', value: roundCurrency(totalExpense * 0.55) },
    { name: '食材', value: roundCurrency(totalExpense * 0.21) },
    { name: '人工', value: roundCurrency(totalExpense * 0.16) },
    { name: '其他', value: roundCurrency(totalExpense * 0.08) },
  ]
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

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}
