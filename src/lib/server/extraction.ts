import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db/client'
import { extractionResults, intakeJobs, sourceDocuments } from '@/lib/db/schema'
import {
  getMadridTodayInputValue,
  type InvoiceHeaderDraft,
  type InvoiceJobStatus,
  type InvoiceLineItemDraft,
  type InvoiceReviewJob,
} from '@/lib/server/app-domain'
import {
  hasWorkersAiBinding,
  requireBinding,
  type AppBindings,
} from '@/lib/server/bindings'
import type { InvoiceIntakeQueueMessage } from '@/lib/server/queue'

export interface InvoiceExtractionDraft {
  pageCount: number
  header: InvoiceHeaderDraft
  lineItems: InvoiceLineItemDraft[]
  markdownText: string
  provider: string
  model: string
}

interface StoredInvoiceExtractionDraft {
  pageCount?: number
  header?: Partial<InvoiceHeaderDraft>
  lineItems?: Array<Partial<InvoiceLineItemDraft>>
  markdownText?: string
  provider?: string
  model?: string
}

interface DocumentNormalizationResult {
  markdownText: string
  provider: string
  model: string
  rawResponse: string | null
}

export function createPendingExtractionDraft(
  fileName: string,
): InvoiceExtractionDraft {
  const fileStem = getFileStem(fileName)
  const today = getMadridTodayInputValue()

  return {
    pageCount: 1,
    header: {
      supplier: fileStem,
      invoiceNo: '',
      date: today,
      totalAmount: '',
      taxAmount: '',
      notes: '文档已入队，等待 OCR 与结构化抽取完成。',
    },
    lineItems: [
      {
        id: `${slugifyText(fileName)}-pending-1`,
        name: '待抽取明细',
        qty: '1',
        unit: '件',
        unitPrice: '',
        ingredient: '',
        matched: false,
      },
    ],
    markdownText: '',
    provider: 'pending',
    model: 'queued',
  }
}

export function parseStoredExtractionDraft(
  rawStructuredJson: string | null | undefined,
  fileName: string,
): InvoiceExtractionDraft {
  if (!rawStructuredJson) {
    return createPendingExtractionDraft(fileName)
  }

  try {
    const parsed = JSON.parse(rawStructuredJson) as StoredInvoiceExtractionDraft
    const pendingDraft = createPendingExtractionDraft(fileName)
    const lineItems =
      parsed.lineItems
        ?.map((item, index) => normalizeLineItemDraft(item, fileName, index))
        .filter((item): item is InvoiceLineItemDraft => item !== null) ?? []

    return {
      pageCount:
        typeof parsed.pageCount === 'number' && parsed.pageCount > 0
          ? Math.round(parsed.pageCount)
          : pendingDraft.pageCount,
      header: normalizeHeaderDraft(parsed.header, pendingDraft.header),
      lineItems:
        lineItems.length > 0 ? lineItems : pendingDraft.lineItems.map(cloneLineItemDraft),
      markdownText:
        typeof parsed.markdownText === 'string'
          ? parsed.markdownText
          : pendingDraft.markdownText,
      provider:
        typeof parsed.provider === 'string' && parsed.provider.length > 0
          ? parsed.provider
          : pendingDraft.provider,
      model:
        typeof parsed.model === 'string' && parsed.model.length > 0
          ? parsed.model
          : pendingDraft.model,
    }
  } catch {
    return createPendingExtractionDraft(fileName)
  }
}

export function serializeExtractionDraft(
  draft: InvoiceExtractionDraft,
): string {
  return JSON.stringify(draft)
}

export function mapIntakeStageToInvoiceStatus(stage: string): InvoiceJobStatus {
  switch (stage) {
    case 'error':
      return 'error'
    case 'ready':
      return 'ready'
    case 'uploaded':
    case 'queued':
    case 'extracting':
      return 'uploaded'
    default:
      return 'needs_review'
  }
}

export function buildInvoiceReviewJob(input: {
  jobId: string
  fileName: string
  uploadedAt: string
  stage: string
  errorMessage?: string | null
  structuredJson?: string | null
}): InvoiceReviewJob {
  const draft = parseStoredExtractionDraft(input.structuredJson, input.fileName)

  return {
    jobId: input.jobId,
    fileName: input.fileName,
    uploadedAt: input.uploadedAt,
    pageCount: Math.max(1, draft.pageCount),
    status: mapIntakeStageToInvoiceStatus(input.stage),
    stage: normalizeIntakeStage(input.stage),
    errorMessage: input.errorMessage ?? null,
    header: draft.header,
    lineItems: draft.lineItems.map(cloneLineItemDraft),
  }
}

export function extractInvoiceReviewDraft(input: {
  fileName: string
  markdownText: string
  provider: string
  model: string
}): InvoiceExtractionDraft {
  const pendingDraft = createPendingExtractionDraft(input.fileName)
  const markdownText = input.markdownText.trim()
  const extractedDate = extractDate(markdownText)
  const extractedInvoiceNo = extractInvoiceNumber(markdownText)
  const extractedTotalAmount = extractAmount(markdownText, [
    'total',
    'importe total',
    'grand total',
    '总计',
    '合计',
  ])
  const extractedTaxAmount = extractAmount(markdownText, [
    'iva',
    'tax',
    'vat',
    '税额',
  ])
  const extractedSupplier = extractSupplierName(markdownText, input.fileName)
  const extractedLineItems = extractLineItems(markdownText, input.fileName)

  return {
    pageCount: Math.max(1, countDocumentPages(markdownText)),
    header: {
      supplier: extractedSupplier,
      invoiceNo: extractedInvoiceNo,
      date: extractedDate ?? pendingDraft.header.date,
      totalAmount: extractedTotalAmount,
      taxAmount: extractedTaxAmount,
      notes: markdownText
        ? '已生成初始抽取草稿，请核对供应商、金额与原料映射。'
        : pendingDraft.header.notes,
    },
    lineItems:
      extractedLineItems.length > 0
        ? extractedLineItems
        : pendingDraft.lineItems.map(cloneLineItemDraft),
    markdownText,
    provider: input.provider,
    model: input.model,
  }
}

export async function processInvoiceIntakeQueueMessage(
  env: AppBindings,
  message: InvoiceIntakeQueueMessage,
) {
  const db = getDb(env)
  const documentsBucket = requireBinding(env.RAW_DOCUMENTS, 'RAW_DOCUMENTS')

  if (!db) {
    throw new Error('Missing Cloudflare binding: DB')
  }

  const [jobRow] = await db
    .select({
      stage: intakeJobs.stage,
    })
    .from(intakeJobs)
    .where(eq(intakeJobs.id, message.jobId))
    .limit(1)

  if (!jobRow) {
    throw new Error(`Intake job not found: ${message.jobId}`)
  }

  if (isTerminalIntakeStage(jobRow.stage)) {
    return {
      jobId: message.jobId,
      stage: jobRow.stage,
    }
  }

  const startedAt = new Date().toISOString()

  await db
    .update(intakeJobs)
    .set({
      stage: 'extracting',
      errorMessage: null,
      updatedAt: startedAt,
    })
    .where(eq(intakeJobs.id, message.jobId))

  try {
    const documentObject = await documentsBucket.get(message.r2Key)
    if (!documentObject) {
      throw new Error(`R2 object not found: ${message.r2Key}`)
    }

    const mimeType =
      message.mimeType ||
      documentObject.httpMetadata?.contentType ||
      'application/octet-stream'
    const blob = new Blob([await documentObject.arrayBuffer()], { type: mimeType })
    const normalization = await normalizeInvoiceDocument(env, {
      fileName: message.fileName,
      blob,
    })
    const extractionDraft = extractInvoiceReviewDraft({
      fileName: message.fileName,
      markdownText: normalization.markdownText,
      provider: normalization.provider,
      model: normalization.model,
    })

    const extractionStoredAt = new Date().toISOString()

    await db
      .insert(extractionResults)
      .values({
        id: getExtractionResultId(message.jobId),
        intakeJobId: message.jobId,
        markdownText: extractionDraft.markdownText,
        structuredJson: serializeExtractionDraft(extractionDraft),
        rawResponse: normalization.rawResponse,
        schemaVersion: 'invoice-extraction-v1',
        createdAt: extractionStoredAt,
      })
      .onConflictDoUpdate({
        target: extractionResults.id,
        set: {
          markdownText: extractionDraft.markdownText,
          structuredJson: serializeExtractionDraft(extractionDraft),
          rawResponse: normalization.rawResponse,
          schemaVersion: 'invoice-extraction-v1',
          createdAt: extractionStoredAt,
        },
      })

    const finishedAt = new Date().toISOString()

    await db
      .update(intakeJobs)
      .set({
        stage: 'needs_review',
        extractorProvider: normalization.provider,
        extractorModel: normalization.model,
        confidenceScore: calculateDraftConfidence(extractionDraft),
        errorMessage: null,
        updatedAt: finishedAt,
      })
      .where(eq(intakeJobs.id, message.jobId))

    await db
      .update(sourceDocuments)
      .set({
        status: 'processed',
      })
      .where(eq(sourceDocuments.id, message.sourceDocumentId))

    return {
      jobId: message.jobId,
      stage: 'needs_review',
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    const errorMessage = formatErrorMessage(error)

    await db
      .update(intakeJobs)
      .set({
        stage: 'error',
        errorMessage,
        updatedAt: failedAt,
      })
      .where(eq(intakeJobs.id, message.jobId))

    await db
      .update(sourceDocuments)
      .set({
        status: 'error',
      })
      .where(eq(sourceDocuments.id, message.sourceDocumentId))

    throw error
  }
}

export function isTerminalIntakeStage(stage: string) {
  return stage === 'needs_review' || stage === 'ready'
}

export function getExtractionResultId(jobId: string) {
  return `ext_${jobId}`
}

async function normalizeInvoiceDocument(
  env: AppBindings,
  input: {
    fileName: string
    blob: Blob
  },
): Promise<DocumentNormalizationResult> {
  if (hasWorkersAiBinding(env)) {
    const conversionResult = await env.AI.toMarkdown({
      name: input.fileName,
      blob: input.blob,
    })

    if (conversionResult.format !== 'markdown') {
      throw new Error(
        `Unsupported AI normalization format: ${conversionResult.format}`,
      )
    }

    return {
      markdownText: conversionResult.data,
      provider: 'workers-ai',
      model: 'to-markdown',
      rawResponse: JSON.stringify({
        id: conversionResult.id,
        mimeType: conversionResult.mimeType,
        tokens: conversionResult.tokens,
        format: conversionResult.format,
      }),
    }
  }

  return {
    markdownText: '',
    provider: 'heuristic',
    model: 'filename-fallback-v1',
    rawResponse: null,
  }
}

function normalizeHeaderDraft(
  value: Partial<InvoiceHeaderDraft> | undefined,
  fallback: InvoiceHeaderDraft,
): InvoiceHeaderDraft {
  return {
    supplier:
      typeof value?.supplier === 'string' ? value.supplier : fallback.supplier,
    invoiceNo:
      typeof value?.invoiceNo === 'string' ? value.invoiceNo : fallback.invoiceNo,
    date: typeof value?.date === 'string' ? value.date : fallback.date,
    totalAmount:
      typeof value?.totalAmount === 'string'
        ? value.totalAmount
        : fallback.totalAmount,
    taxAmount:
      typeof value?.taxAmount === 'string' ? value.taxAmount : fallback.taxAmount,
    notes: typeof value?.notes === 'string' ? value.notes : fallback.notes,
  }
}

function normalizeLineItemDraft(
  value: Partial<InvoiceLineItemDraft> | undefined,
  fileName: string,
  index: number,
): InvoiceLineItemDraft | null {
  if (!value || typeof value.name !== 'string' || value.name.trim().length === 0) {
    return null
  }

  return {
    id:
      typeof value.id === 'string' && value.id.length > 0
        ? value.id
        : `${slugifyText(fileName)}-${index + 1}`,
    name: value.name,
    qty: typeof value.qty === 'string' ? value.qty : '',
    unit: typeof value.unit === 'string' ? value.unit : '',
    unitPrice: typeof value.unitPrice === 'string' ? value.unitPrice : '',
    ingredient: typeof value.ingredient === 'string' ? value.ingredient : '',
    matched:
      (typeof value.ingredient === 'string' && value.ingredient.trim().length > 0) ||
      value.matched === true,
  }
}

function cloneLineItemDraft(item: InvoiceLineItemDraft): InvoiceLineItemDraft {
  return { ...item }
}

function countDocumentPages(markdownText: string) {
  if (!markdownText.trim()) {
    return 1
  }

  const pageBreakMatches =
    markdownText.match(/\f|^#\s+page\s+\d+/gim)?.length ?? 0

  return Math.max(1, pageBreakMatches + 1)
}

function extractSupplierName(markdownText: string, fileName: string) {
  const meaningfulLine = markdownText
    .split('\n')
    .map((line) => line.replace(/[#>*`]/g, '').trim())
    .find(
      (line) =>
        line.length >= 3 &&
        !/^\d/.test(line) &&
        !line.includes('|') &&
        !/(invoice|factura|发票|date|fecha|日期|iva|tax|total)/i.test(line),
    )

  return meaningfulLine || getFileStem(fileName)
}

function extractInvoiceNumber(markdownText: string) {
  const invoiceNumberPattern =
    /(?:invoice(?:\s+no|\s+number)?|factura|发票号|numero)\s*[:：#]?\s*([A-Z0-9/-]+)/i

  return markdownText.match(invoiceNumberPattern)?.[1] ?? ''
}

function extractDate(markdownText: string) {
  const match = markdownText.match(
    /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/,
  )?.[1]

  if (!match) {
    return null
  }

  if (/^\d{4}/.test(match)) {
    return match.replace(/\//g, '-').replace(/-(\d)(?!\d)/g, '-0$1')
  }

  const [day, month, year] = match.split(/[/-]/)
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function extractAmount(markdownText: string, labels: string[]) {
  for (const label of labels) {
    const expression = new RegExp(
      `${escapeRegExp(label)}[^\\d\\n]{0,20}(\\d+[.,]\\d{2})`,
      'i',
    )
    const matchedAmount = markdownText.match(expression)?.[1]
    if (matchedAmount) {
      return normalizeMoneyValue(matchedAmount)
    }
  }

  return ''
}

function extractLineItems(markdownText: string, fileName: string) {
  const lines = markdownText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const extractedItems: InvoiceLineItemDraft[] = []

  for (const line of lines) {
    if (!line.includes('|')) {
      continue
    }

    if (/^\|?[-\s|:]+\|?$/.test(line)) {
      continue
    }

    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)

    if (cells.length < 2) {
      continue
    }

    const productName = cells[0]
    if (
      /(producto|item|description|cantidad|precio|importe|单价|数量|商品)/i.test(
        productName,
      )
    ) {
      continue
    }

    const amountCells = cells
      .map((cell) => normalizeMoneyValue(cell))
      .filter(Boolean)
    const quantityCell = cells.find((cell, index) => index > 0 && /^\d+[.,]?\d*$/.test(cell))

    extractedItems.push({
      id: `${slugifyText(fileName)}-${extractedItems.length + 1}`,
      name: productName,
      qty: quantityCell?.replace(',', '.') ?? '1',
      unit: inferUnit(cells) ?? '件',
      unitPrice: amountCells.at(-1) ?? '',
      ingredient: '',
      matched: false,
    })

    if (extractedItems.length >= 8) {
      break
    }
  }

  return extractedItems
}

function inferUnit(cells: string[]) {
  return (
    cells
      .slice(1)
      .find((cell) => /^(kg|g|l|ml|ud|pcs|件|箱|瓶|包)$/i.test(cell)) ?? ''
  )
}

function calculateDraftConfidence(draft: InvoiceExtractionDraft) {
  const headerFields = [
    draft.header.supplier,
    draft.header.invoiceNo,
    draft.header.date,
    draft.header.totalAmount,
    draft.header.taxAmount,
  ]
  const completedHeaderCount = headerFields.filter((value) => value.trim().length > 0).length
  const lineItemSignal = draft.lineItems.some((item) => item.name.trim().length > 0) ? 1 : 0

  return Math.min(1, Number(((completedHeaderCount + lineItemSignal) / 6).toFixed(2)))
}

function normalizeMoneyValue(value: string) {
  const matchedValue = value.match(/(\d+(?:[.,]\d{2})?)/)?.[1]
  return matchedValue ? matchedValue.replace(',', '.') : ''
}

function getFileStem(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim()
}

function slugifyText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown extraction failure'
}

function normalizeIntakeStage(stage: string): InvoiceReviewJob['stage'] {
  switch (stage) {
    case 'uploaded':
    case 'queued':
    case 'extracting':
    case 'needs_review':
    case 'ready':
    case 'error':
      return stage
    default:
      return 'needs_review'
  }
}
