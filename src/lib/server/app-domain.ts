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

export type InvoiceJobStatus = 'uploaded' | 'needs_review' | 'ready'

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

export const ingredientOptions: IngredientOption[] = [
  { value: 'heineken-330', label: 'Heineken 啤酒 330ml' },
  { value: 'absolut-750', label: 'Absolut Vodka 750ml' },
  { value: 'coke-330', label: '可口可乐 330ml' },
  { value: 'lemon', label: '柠檬' },
  { value: 'mint', label: '薄荷叶' },
  { value: 'lime', label: '青柠' },
]

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
    case 'ready':
      return '可入账'
    default:
      return '待核对'
  }
}
