export type PaymentChannelId = 'bbva' | 'caixa' | 'efectivo'

export interface PaymentChannel {
  id: PaymentChannelId
  name: string
  color: string
}

export type SalesRecordStatus = 'draft' | 'submitted'

export interface SalesDailyRecord {
  id: string
  date: string
  totalAmount: number
  bbvaAmount: number
  caixaAmount: number
  cashAmount: number
  status: SalesRecordStatus
  note: string
  updatedAt: string
}

export interface SalesDailyDraftInput {
  date: string
  amounts: Record<PaymentChannelId, string>
  notes: string
}

export type InvoiceJobStatus = 'uploaded' | 'needs_review' | 'ready' | 'error'

export type InvoiceIntakeStage =
  | 'uploaded'
  | 'queued'
  | 'extracting'
  | 'needs_review'
  | 'ready'
  | 'error'

export interface InvoiceHeaderDraft {
  supplier: string
  invoiceNo: string
  date: string
  totalAmount: string
  taxAmount: string
  notes: string
}

export interface InvoiceLineItemDraft {
  id: string
  name: string
  qty: string
  unit: string
  unitPrice: string
  ingredient: string
  matched: boolean
}

export interface IngredientOption {
  value: string
  label: string
}

export interface InvoiceReviewJob {
  jobId: string
  fileName: string
  uploadedAt: string
  pageCount: number
  status: InvoiceJobStatus
  stage?: InvoiceIntakeStage
  errorMessage?: string | null
  header: InvoiceHeaderDraft
  lineItems: InvoiceLineItemDraft[]
}

export interface InvoiceReadinessSummary {
  isReady: boolean
  missingHeaderFields: string[]
  invalidHeaderFields: string[]
  unmatchedLineItems: number
}

export interface DashboardSummary {
  todayLabel: string
  salesRecordedToday: boolean
  pendingInvoiceCount: number
  monthlyInvoiceCount: number
  monthlyExpenseTotal: number
  lastActivityLabel: string
}

export interface MonthlyAnalyticsPoint {
  name: string
  value: number
  percentage: number
}

export interface WeeklyAnalyticsPoint {
  week: string
  income: number
  expense: number
}

export interface MonthlyAnalyticsSummary {
  selectedMonth: string
  monthOptions: Array<{ value: string; label: string }>
  incomeBreakdown: MonthlyAnalyticsPoint[]
  expenseBreakdown: MonthlyAnalyticsPoint[]
  weeklyTrend: WeeklyAnalyticsPoint[]
  totalIncome: number
  totalExpense: number
  totalNet: number
  profitMargin: number
  incomeTrend: number
  expenseTrend: number
  netTrend: number
  marginDelta: number
}

export interface CalendarDaySummary {
  income: number
  expense: number
}

export interface CalendarAnalyticsSummary {
  selectedMonth: string
  monthName: string
  monthOptions: Array<{ value: string; label: string }>
  days: Record<string, CalendarDaySummary>
  totalIncome: number
  totalExpense: number
}

export const paymentChannels: PaymentChannel[] = [
  { id: 'bbva', name: 'BBVA', color: 'bg-blue-500' },
  { id: 'caixa', name: 'CAIXA', color: 'bg-red-500' },
  { id: 'efectivo', name: 'EFECTIVO', color: 'bg-emerald-500' },
]

const requiredInvoiceHeaderFieldLabels = {
  supplier: '供应商',
  invoiceNo: '发票号',
  date: '发票日期',
  totalAmount: '总金额',
  taxAmount: '税额',
} satisfies Record<RequiredInvoiceHeaderField, string>

export function getMadridTodayInputValue() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
  }).format(new Date())
}

export function formatInvoiceTimestamp(isoTimestamp: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoTimestamp))
}

export function getInvoiceStatusLabel(status: InvoiceJobStatus) {
  switch (status) {
    case 'uploaded':
      return '已创建'
    case 'error':
      return '处理失败'
    case 'ready':
      return '可入账'
    default:
      return '待核对'
  }
}

export function getInvoiceJobStage(
  job: Pick<InvoiceReviewJob, 'stage' | 'status'>,
): InvoiceIntakeStage {
  if (job.stage) {
    return job.stage
  }

  switch (job.status) {
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    case 'needs_review':
      return 'needs_review'
    default:
      return 'uploaded'
  }
}

export function isInvoiceJobProcessing(
  job: Pick<InvoiceReviewJob, 'stage' | 'status'>,
) {
  const stage = getInvoiceJobStage(job)
  return stage === 'queued' || stage === 'extracting'
}

export function normalizeSalesDraftInput(
  input: SalesDailyDraftInput,
  status: SalesRecordStatus,
  updatedAt = new Date().toISOString(),
): SalesDailyRecord {
  const bbvaAmount = normalizeDecimalString(input.amounts.bbva)
  const caixaAmount = normalizeDecimalString(input.amounts.caixa)
  const cashAmount = normalizeDecimalString(input.amounts.efectivo)

  return {
    id: `sales-${input.date}`,
    date: input.date,
    totalAmount: roundCurrency(bbvaAmount + caixaAmount + cashAmount),
    bbvaAmount,
    caixaAmount,
    cashAmount,
    status,
    note: input.notes.trim(),
    updatedAt,
  }
}

export function getInvoiceReadinessSummary(
  job: Pick<InvoiceReviewJob, 'header' | 'lineItems'>,
): InvoiceReadinessSummary {
  const missingHeaderFields = getMissingRequiredHeaderFields(job.header)
  const invalidHeaderFields = getInvalidHeaderFields(job.header)
  const unmatchedLineItems = job.lineItems.filter((item) => !item.matched).length

  return {
    isReady:
      missingHeaderFields.length === 0 &&
      invalidHeaderFields.length === 0 &&
      unmatchedLineItems === 0,
    missingHeaderFields,
    invalidHeaderFields,
    unmatchedLineItems,
  }
}

export function getMonthOptions(referenceMonth = getMonthKey(getMadridTodayInputValue())) {
  const [yearText, monthText] = referenceMonth.split('-')
  const anchorYear = Number.parseInt(yearText, 10)
  const anchorMonth = Number.parseInt(monthText, 10)

  return Array.from({ length: 3 }, (_, index) => {
    const date = new Date(anchorYear, anchorMonth - 1 - index, 1, 12)
    const value = formatMonthKey(date)
    return {
      value,
      label: date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
      }),
    }
  })
}

export function parseCurrencyAmount(value: string) {
  const normalizedValue = value.trim().replace(',', '.')
  const parsedValue = Number.parseFloat(normalizedValue)
  return Number.isFinite(parsedValue) ? roundCurrency(parsedValue) : 0
}

export function parseOptionalCurrencyAmount(value: string) {
  return value.trim() === '' ? null : parseCurrencyAmount(value)
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function normalizeDecimalString(value: string) {
  const parsedValue = Number.parseFloat(value)
  return Number.isFinite(parsedValue) ? roundCurrency(parsedValue) : 0
}

function getMissingRequiredHeaderFields(header: InvoiceHeaderDraft) {
  return typedEntries(requiredInvoiceHeaderFieldLabels)
    .filter(([field]) => header[field].trim() === '')
    .map(([, label]) => label)
}

function getInvalidHeaderFields(header: InvoiceHeaderDraft) {
  const invalidFields: string[] = []

  if (header.totalAmount.trim() !== '' && !isInvoiceAmount(header.totalAmount)) {
    invalidFields.push('总金额')
  }

  if (header.taxAmount.trim() !== '' && !isInvoiceAmount(header.taxAmount)) {
    invalidFields.push('税额')
  }

  return invalidFields
}

function isInvoiceAmount(value: string) {
  const normalizedValue = value.trim().replace(',', '.')
  return /^\d+(?:\.\d{1,2})?$/.test(normalizedValue)
}

function typedEntries<T extends Record<string, string>>(record: T) {
  return Object.entries(record) as Array<[keyof T & string, T[keyof T & string]]>
}

function formatMonthKey(date: Date) {
  return [
    date.getFullYear().toString(),
    String(date.getMonth() + 1).padStart(2, '0'),
  ].join('-')
}

function getMonthKey(date: string) {
  return date.slice(0, 7)
}

type RequiredInvoiceHeaderField = Exclude<keyof InvoiceHeaderDraft, 'notes'>
