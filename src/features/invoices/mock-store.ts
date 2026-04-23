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

export const ingredientOptions: IngredientOption[] = [
  { value: 'heineken-330', label: 'Heineken 啤酒 330ml' },
  { value: 'absolut-750', label: 'Absolut Vodka 750ml' },
  { value: 'coke-330', label: '可口可乐 330ml' },
  { value: 'lemon', label: '柠檬' },
  { value: 'mint', label: '薄荷叶' },
  { value: 'lime', label: '青柠' },
]

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

const jobStore = new Map(seedJobs.map((job) => [job.jobId, cloneJob(job)]))

export function listInvoiceJobs() {
  return Array.from(jobStore.values())
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
    .map(cloneJob)
}

export function getInvoiceJob(jobId: string) {
  const job = jobStore.get(jobId)
  return job ? cloneJob(job) : undefined
}

export function getOrCreateInvoiceJob(jobId: string) {
  const existing = getInvoiceJob(jobId)
  if (existing) {
    return existing
  }

  const fallbackJob = createBaseJob(jobId, `invoice-${jobId}.jpg`)
  jobStore.set(jobId, cloneJob(fallbackJob))
  return fallbackJob
}

export function createInvoiceJob(fileName: string) {
  const jobId = `job-${Date.now().toString(36)}`
  const createdJob = createBaseJob(jobId, fileName)
  jobStore.set(jobId, cloneJob(createdJob))
  return createdJob
}

export function saveInvoiceJob(job: InvoiceReviewJob) {
  jobStore.set(job.jobId, cloneJob(normalizeJob(job)))
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
    matched: Boolean(item.ingredient),
  }))

  const nextStatus = lineItems.every((item) => item.matched) ? 'ready' : 'needs_review'

  return {
    ...job,
    status: nextStatus,
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

function getMadridTodayInputValue() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
  }).format(new Date())
}
