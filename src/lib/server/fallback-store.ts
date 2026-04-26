import type {
  CalendarDaySummary,
  InvoiceHeaderDraft,
  InvoiceJobStatus,
  InvoiceLineItemDraft,
  InvoiceReadinessSummary,
  InvoiceReviewJob,
  SalesDailyDraftInput,
  SalesDailyRecord,
  SalesRecordStatus,
} from '@/lib/server/app-domain'
import { getMadridTodayInputValue } from '@/lib/server/app-domain'

const SALES_STORAGE_KEY = 'bescuit-operation-assistant:sales-daily'
const INVOICE_SESSION_STORAGE_KEY = 'bescuit-operation-assistant:invoice-jobs'

const requiredInvoiceHeaderFieldLabels = {
  supplier: '供应商',
  invoiceNo: '发票号',
  date: '发票日期',
  totalAmount: '总金额',
  taxAmount: '税额',
} satisfies Record<RequiredInvoiceHeaderField, string>

export function listStoredSalesRecords() {
  const persistedRecords = readSalesRecords()
  const mergedRecords = new Map(
    getSeedSalesRecords().map((record) => [record.date, cloneSalesRecord(record)]),
  )

  for (const record of persistedRecords) {
    mergedRecords.set(record.date, cloneSalesRecord(record))
  }

  return Array.from(mergedRecords.values()).sort((left, right) =>
    right.date.localeCompare(left.date),
  )
}

export function getStoredSalesRecord(date: string) {
  const record = listStoredSalesRecords().find((candidate) => candidate.date === date)
  return record ? cloneSalesRecord(record) : undefined
}

export function listSubmittedSalesRecords() {
  return listStoredSalesRecords().filter((record) => record.status === 'submitted')
}

export function upsertStoredSalesRecord(
  input: SalesDailyDraftInput,
  status: SalesRecordStatus,
) {
  const nextRecord = normalizeSalesRecord(input, status)
  const storedRecords = readSalesRecords().filter((record) => record.date !== input.date)
  storedRecords.push(nextRecord)
  persistSalesRecords(storedRecords)
  return cloneSalesRecord(nextRecord)
}

export function listStoredInvoiceJobs() {
  const jobMap = new Map(
    getSeedInvoiceJobs().map((job) => [job.jobId, cloneInvoiceJob(job)]),
  )

  for (const storedJob of readStoredInvoiceJobs()) {
    jobMap.set(storedJob.jobId, cloneInvoiceJob(normalizeInvoiceJob(storedJob)))
  }

  return Array.from(jobMap.values())
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
    .map(cloneInvoiceJob)
}

export function getStoredInvoiceJob(jobId: string) {
  const job = listStoredInvoiceJobs().find((candidate) => candidate.jobId === jobId)
  return job ? cloneInvoiceJob(job) : undefined
}

export function createStoredInvoiceJob(fileName: string) {
  const jobId = `job-${Date.now().toString(36)}`
  const createdJob = normalizeInvoiceJob({
    jobId,
    fileName,
    uploadedAt: new Date().toISOString(),
    pageCount: 1,
    status: 'uploaded',
    stage: 'uploaded',
    errorMessage: null,
    header: {
      supplier: '',
      invoiceNo: '',
      date: getMadridTodayInputValue(),
      totalAmount: '',
      taxAmount: '',
      notes: '新建 intake job，等待 OCR 结果回填。',
    },
    lineItems: [
      {
        id: `${jobId}-1`,
        name: '待识别商品 1',
        qty: '1',
        unit: '件',
        unitPrice: '',
        ingredient: '',
        matched: false,
      },
      {
        id: `${jobId}-2`,
        name: '待识别商品 2',
        qty: '1',
        unit: '件',
        unitPrice: '',
        ingredient: '',
        matched: false,
      },
    ],
  })

  upsertStoredInvoiceJob(createdJob)
  return createdJob
}

export function upsertStoredInvoiceJob(job: InvoiceReviewJob) {
  const normalizedJob = normalizeInvoiceJob(job)
  const storedJobs = readStoredInvoiceJobs().filter(
    (storedJob) => storedJob.jobId !== normalizedJob.jobId,
  )

  storedJobs.push(normalizedJob)
  persistStoredInvoiceJobs(storedJobs)
  return cloneInvoiceJob(normalizedJob)
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

export function getCalendarMonthBase(month: string) {
  const [year, monthNumber] = month.split('-').map((value) => Number.parseInt(value, 10))
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const dayEntries: Record<string, CalendarDaySummary> = {}
  const seed = year * 97 + monthNumber * 31

  for (let day = 1; day <= daysInMonth; day += 1) {
    if ((seed + day * 7) % 5 === 0) {
      continue
    }

    dayEntries[day.toString()] = {
      income: 500 + ((seed * (day + 3)) % 1400),
      expense: 220 + ((seed + day * 13) % 780),
    }
  }

  return dayEntries
}

export function getApprovedInvoiceTotalsByDay(month: string) {
  const totals = new Map<string, number>()

  for (const job of listStoredInvoiceJobs()) {
    if (job.status !== 'ready' || !job.header.date.startsWith(month)) {
      continue
    }

    const currentTotal = totals.get(job.header.date) ?? 0
    totals.set(
      job.header.date,
      currentTotal + normalizeInvoiceAmount(job.header.totalAmount),
    )
  }

  return totals
}

function readSalesRecords() {
  if (!canUseLocalStorage()) {
    return []
  }

  const rawValue = window.localStorage.getItem(SALES_STORAGE_KEY)
  if (!rawValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue
      .map(toSalesDailyRecord)
      .filter((record): record is SalesDailyRecord => record !== null)
      .map(cloneSalesRecord)
  } catch {
    window.localStorage.removeItem(SALES_STORAGE_KEY)
    return []
  }
}

function persistSalesRecords(records: SalesDailyRecord[]) {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.setItem(
    SALES_STORAGE_KEY,
    JSON.stringify(records.map(cloneSalesRecord)),
  )
}

function readStoredInvoiceJobs() {
  if (!canUseSessionStorage()) {
    return []
  }

  const rawValue = window.sessionStorage.getItem(INVOICE_SESSION_STORAGE_KEY)
  if (!rawValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue.filter(isInvoiceReviewJob).map(cloneInvoiceJob)
  } catch {
    window.sessionStorage.removeItem(INVOICE_SESSION_STORAGE_KEY)
    return []
  }
}

function persistStoredInvoiceJobs(jobs: InvoiceReviewJob[]) {
  if (!canUseSessionStorage()) {
    return
  }

  window.sessionStorage.setItem(
    INVOICE_SESSION_STORAGE_KEY,
    JSON.stringify(jobs.map(cloneInvoiceJob)),
  )
}

function canUseLocalStorage() {
  return (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined' &&
    typeof window.localStorage.getItem === 'function' &&
    typeof window.localStorage.setItem === 'function' &&
    typeof window.localStorage.removeItem === 'function'
  )
}

function canUseSessionStorage() {
  return (
    typeof window !== 'undefined' &&
    typeof window.sessionStorage !== 'undefined' &&
    typeof window.sessionStorage.getItem === 'function' &&
    typeof window.sessionStorage.setItem === 'function' &&
    typeof window.sessionStorage.removeItem === 'function'
  )
}

function normalizeSalesRecord(
  input: SalesDailyDraftInput,
  status: SalesRecordStatus,
): SalesDailyRecord {
  const bbvaAmount = normalizeDecimalString(input.amounts.bbva)
  const caixaAmount = normalizeDecimalString(input.amounts.caixa)
  const cashAmount = normalizeDecimalString(input.amounts.efectivo)

  return {
    id: `sales-${input.date}`,
    date: input.date,
    totalAmount: bbvaAmount + caixaAmount + cashAmount,
    bbvaAmount,
    caixaAmount,
    cashAmount,
    status,
    note: input.notes.trim(),
    updatedAt: new Date().toISOString(),
  }
}

function getSeedSalesRecords(): SalesDailyRecord[] {
  const month = getMonthKey(getMadridTodayInputValue())
  const baseCalendar = getCalendarMonthBase(month)

  return Object.entries(baseCalendar)
    .slice(0, 12)
    .map(([day, summary]) => {
      const paddedDay = day.padStart(2, '0')
      const income = summary.income
      const bbvaAmount = roundCurrency(income * 0.45)
      const caixaAmount = roundCurrency(income * 0.3)
      const cashAmount = roundCurrency(income - bbvaAmount - caixaAmount)
      return {
        id: `seed-sales-${month}-${paddedDay}`,
        date: `${month}-${paddedDay}`,
        totalAmount: income,
        bbvaAmount,
        caixaAmount,
        cashAmount,
        status: 'submitted',
        note: '系统初始化样例数据',
        updatedAt: `${month}-${paddedDay}T20:00:00.000Z`,
      }
    })
}

function getSeedInvoiceJobs(): InvoiceReviewJob[] {
  return [
    {
      jobId: 'demo-metro-apr',
      fileName: 'metro-2026-04-18.jpg',
      uploadedAt: '2026-04-18T09:20:00.000Z',
      pageCount: 2,
      status: 'needs_review',
      stage: 'needs_review',
      errorMessage: null,
      header: {
        supplier: 'Metro Cash & Carry',
        invoiceNo: 'INV-2026-001234',
        date: '2026-04-18',
        totalAmount: '156.30',
        taxAmount: '21.70',
        notes: 'OCR 已识别基础字段，等待确认原料映射。',
      },
      lineItems: [
        {
          id: 'metro-1',
          name: 'Heineken 啤酒 330ml',
          qty: '24',
          unit: '瓶',
          unitPrice: '1.20',
          ingredient: 'heineken-330',
          matched: true,
        },
        {
          id: 'metro-2',
          name: 'Absolut Vodka 750ml',
          qty: '6',
          unit: '瓶',
          unitPrice: '12.50',
          ingredient: 'absolut-750',
          matched: true,
        },
        {
          id: 'metro-3',
          name: '柠檬',
          qty: '5',
          unit: 'kg',
          unitPrice: '2.80',
          ingredient: '',
          matched: false,
        },
        {
          id: 'metro-4',
          name: '薄荷叶',
          qty: '2',
          unit: '盒',
          unitPrice: '4.50',
          ingredient: '',
          matched: false,
        },
      ],
    },
    {
      jobId: 'demo-supplier-ready',
      fileName: 'supplier-2026-04-16.pdf',
      uploadedAt: '2026-04-16T13:45:00.000Z',
      pageCount: 3,
      status: 'ready',
      stage: 'ready',
      errorMessage: null,
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-16',
        totalAmount: '248.90',
        taxAmount: '34.56',
        notes: '已完成映射，可进入后续入账流程。',
      },
      lineItems: [
        {
          id: 'ready-1',
          name: '可口可乐 330ml',
          qty: '48',
          unit: '罐',
          unitPrice: '0.45',
          ingredient: 'coke-330',
          matched: true,
        },
        {
          id: 'ready-2',
          name: '青柠',
          qty: '8',
          unit: 'kg',
          unitPrice: '3.10',
          ingredient: 'lime',
          matched: true,
        },
      ],
    },
    {
      jobId: 'demo-bodega-ready',
      fileName: 'bodega-2026-04-09.pdf',
      uploadedAt: '2026-04-09T08:12:00.000Z',
      pageCount: 1,
      status: 'ready',
      stage: 'ready',
      errorMessage: null,
      header: {
        supplier: 'Bodega Local',
        invoiceNo: 'BD-240409',
        date: '2026-04-09',
        totalAmount: '118.40',
        taxAmount: '16.45',
        notes: '本地供应商补货，已完成入账前核对。',
      },
      lineItems: [
        {
          id: 'bodega-1',
          name: '薄荷叶',
          qty: '6',
          unit: '盒',
          unitPrice: '4.20',
          ingredient: 'mint',
          matched: true,
        },
        {
          id: 'bodega-2',
          name: '青柠',
          qty: '10',
          unit: 'kg',
          unitPrice: '3.20',
          ingredient: 'lime',
          matched: true,
        },
      ],
    },
  ]
}

function normalizeInvoiceJob(job: InvoiceReviewJob): InvoiceReviewJob {
  const lineItems = job.lineItems.map((item) => ({
    ...item,
    matched: Boolean(item.ingredient.trim()),
  }))

  const readinessSummary = getInvoiceReadinessSummary({
    header: job.header,
    lineItems,
  })
  const stage = normalizeInvoiceJobStage(job)
  const status = normalizeInvoiceJobStatus(stage, readinessSummary.isReady)

  return {
    ...job,
    status,
    stage,
    errorMessage: stage === 'error' ? job.errorMessage ?? null : null,
    lineItems,
  }
}

function cloneInvoiceJob(job: InvoiceReviewJob): InvoiceReviewJob {
  return {
    ...job,
    header: { ...job.header },
    lineItems: job.lineItems.map((item) => ({ ...item })),
  }
}

function cloneSalesRecord(record: SalesDailyRecord): SalesDailyRecord {
  return { ...record }
}

function toSalesDailyRecord(value: unknown): SalesDailyRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const hasBaseShape =
    typeof value.id === 'string' &&
    typeof value.date === 'string' &&
    typeof value.totalAmount === 'number' &&
    typeof value.bbvaAmount === 'number' &&
    typeof value.caixaAmount === 'number' &&
    typeof value.cashAmount === 'number' &&
    typeof value.note === 'string' &&
    typeof value.updatedAt === 'string'

  if (!hasBaseShape) {
    return null
  }

  const id = value.id as string
  const date = value.date as string
  const totalAmount = value.totalAmount as number
  const bbvaAmount = value.bbvaAmount as number
  const caixaAmount = value.caixaAmount as number
  const cashAmount = value.cashAmount as number
  const note = value.note as string
  const updatedAt = value.updatedAt as string

  return {
    id,
    date,
    totalAmount,
    bbvaAmount,
    caixaAmount,
    cashAmount,
    status: isSalesRecordStatus(value.status) ? value.status : 'submitted',
    note,
    updatedAt,
  }
}

function normalizeDecimalString(value: string) {
  const parsedValue = Number.parseFloat(value)
  return Number.isFinite(parsedValue) ? roundCurrency(parsedValue) : 0
}

function normalizeInvoiceAmount(value: string) {
  const normalizedValue = value.trim().replace(',', '.')
  const parsedValue = Number.parseFloat(normalizedValue)
  return Number.isFinite(parsedValue) ? roundCurrency(parsedValue) : 0
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
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

function isSalesRecordStatus(value: unknown): value is SalesRecordStatus {
  return value === 'draft' || value === 'submitted'
}

function isInvoiceReviewJob(value: unknown): value is InvoiceReviewJob {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.jobId === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.uploadedAt === 'string' &&
    typeof value.pageCount === 'number' &&
    isInvoiceJobStatus(value.status) &&
    (typeof value.stage === 'undefined' || isInvoiceJobStage(value.stage)) &&
    (typeof value.errorMessage === 'undefined' ||
      value.errorMessage === null ||
      typeof value.errorMessage === 'string') &&
    isInvoiceHeaderDraft(value.header) &&
    Array.isArray(value.lineItems) &&
    value.lineItems.every(isInvoiceLineItemDraft)
  )
}

function isInvoiceJobStatus(value: unknown): value is InvoiceJobStatus {
  return (
    value === 'uploaded' ||
    value === 'needs_review' ||
    value === 'ready' ||
    value === 'error'
  )
}

function isInvoiceJobStage(value: unknown) {
  return (
    value === 'uploaded' ||
    value === 'queued' ||
    value === 'extracting' ||
    value === 'needs_review' ||
    value === 'ready' ||
    value === 'error'
  )
}

function isInvoiceHeaderDraft(value: unknown): value is InvoiceHeaderDraft {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.supplier === 'string' &&
    typeof value.invoiceNo === 'string' &&
    typeof value.date === 'string' &&
    typeof value.totalAmount === 'string' &&
    typeof value.taxAmount === 'string' &&
    typeof value.notes === 'string'
  )
}

function isInvoiceLineItemDraft(value: unknown): value is InvoiceLineItemDraft {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.qty === 'string' &&
    typeof value.unit === 'string' &&
    typeof value.unitPrice === 'string' &&
    typeof value.ingredient === 'string' &&
    typeof value.matched === 'boolean'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeInvoiceJobStage(job: InvoiceReviewJob) {
  if (job.stage && isInvoiceJobStage(job.stage)) {
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

function normalizeInvoiceJobStatus(stage: string, isReady: boolean): InvoiceJobStatus {
  if (stage === 'error') {
    return 'error'
  }

  if (stage === 'queued' || stage === 'extracting') {
    return 'uploaded'
  }

  return isReady ? 'ready' : 'needs_review'
}

type RequiredInvoiceHeaderField = Exclude<keyof InvoiceHeaderDraft, 'notes'>
