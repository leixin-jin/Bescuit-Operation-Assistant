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

export const ingredientOptions: IngredientOption[] = [
  { value: 'heineken-330', label: 'Heineken 啤酒 330ml' },
  { value: 'absolut-750', label: 'Absolut Vodka 750ml' },
  { value: 'coke-330', label: '可口可乐 330ml' },
  { value: 'lemon', label: '柠檬' },
  { value: 'mint', label: '薄荷叶' },
  { value: 'lime', label: '青柠' },
]

const SESSION_STORAGE_KEY = 'bescuit-operation-assistant:invoice-jobs'

const requiredInvoiceHeaderFieldLabels = {
  supplier: '供应商',
  invoiceNo: '发票号',
  date: '发票日期',
  totalAmount: '总金额',
  taxAmount: '税额',
} satisfies Record<RequiredInvoiceHeaderField, string>

const seedJobs: InvoiceReviewJob[] = [
  {
    jobId: 'demo-metro-apr',
    fileName: 'metro-2026-04-18.jpg',
    uploadedAt: '2026-04-18T09:20:00.000Z',
    pageCount: 2,
    status: 'needs_review',
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
]

export function listInvoiceJobs() {
  return Array.from(getJobSnapshot().values())
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
    .map(cloneJob)
}

export function getInvoiceJob(jobId: string) {
  const job = getJobSnapshot().get(jobId)
  return job ? cloneJob(job) : undefined
}

export function createInvoiceJob(fileName: string) {
  const jobId = `job-${Date.now().toString(36)}`
  const createdJob = createBaseJob(jobId, fileName)
  upsertStoredJob(createdJob)
  return createdJob
}

export function saveInvoiceJob(job: InvoiceReviewJob) {
  upsertStoredJob(job)
}

export function getStatusLabel(status: InvoiceJobStatus) {
  switch (status) {
    case 'uploaded':
      return '已创建'
    case 'ready':
      return '可入账'
    default:
      return '待核对'
  }
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

function createBaseJob(jobId: string, fileName: string): InvoiceReviewJob {
  return {
    jobId,
    fileName,
    uploadedAt: new Date().toISOString(),
    pageCount: 1,
    status: 'uploaded',
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
  }
}

function normalizeJob(job: InvoiceReviewJob): InvoiceReviewJob {
  const lineItems = job.lineItems.map((item) => ({
    ...item,
    matched: Boolean(item.ingredient.trim()),
  }))

  const readinessSummary = getInvoiceReadinessSummary({
    header: job.header,
    lineItems,
  })

  return {
    ...job,
    status: readinessSummary.isReady ? 'ready' : 'needs_review',
    lineItems,
  }
}

function cloneJob(job: InvoiceReviewJob): InvoiceReviewJob {
  return {
    ...job,
    header: { ...job.header },
    lineItems: job.lineItems.map((item) => ({ ...item })),
  }
}

function getJobSnapshot() {
  const jobMap = new Map(seedJobs.map((job) => [job.jobId, cloneJob(job)]))

  for (const storedJob of readStoredJobs()) {
    jobMap.set(storedJob.jobId, cloneJob(normalizeJob(storedJob)))
  }

  return jobMap
}

function upsertStoredJob(job: InvoiceReviewJob) {
  if (!canUseSessionStorage()) {
    return
  }

  const normalizedJob = cloneJob(normalizeJob(job))
  const storedJobs = readStoredJobs().filter(
    (storedJob) => storedJob.jobId !== normalizedJob.jobId,
  )

  storedJobs.push(normalizedJob)
  persistStoredJobs(storedJobs)
}

function readStoredJobs() {
  if (!canUseSessionStorage()) {
    return []
  }

  const serializedJobs = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!serializedJobs) {
    return []
  }

  try {
    const parsedJobs = JSON.parse(serializedJobs)
    if (!Array.isArray(parsedJobs)) {
      return []
    }

    return parsedJobs.filter(isInvoiceReviewJob).map(cloneJob)
  } catch {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    return []
  }
}

function persistStoredJobs(jobs: InvoiceReviewJob[]) {
  if (!canUseSessionStorage()) {
    return
  }

  window.sessionStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(jobs.map(cloneJob)),
  )
}

function canUseSessionStorage() {
  return (
    typeof window !== 'undefined' &&
    typeof window.sessionStorage !== 'undefined'
  )
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
    isInvoiceHeaderDraft(value.header) &&
    Array.isArray(value.lineItems) &&
    value.lineItems.every(isInvoiceLineItemDraft)
  )
}

function isInvoiceJobStatus(value: unknown): value is InvoiceJobStatus {
  return value === 'uploaded' || value === 'needs_review' || value === 'ready'
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
  return Object.entries(record) as Array<
    [keyof T & string, T[keyof T & string]]
  >
}

function getMadridTodayInputValue() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
  }).format(new Date())
}

type RequiredInvoiceHeaderField = Exclude<keyof InvoiceHeaderDraft, 'notes'>
