import { z } from 'zod'

import {
  getMadridTodayInputValue,
  type InvoiceHeaderDraft,
  type InvoiceLineItemDraft,
} from '@/lib/server/app-domain'

export const INVOICE_EXTRACTION_SCHEMA_VERSION = 'invoice-extraction-v2'

export const invoiceExtractionResponseJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'string' },
    pageCount: { type: 'integer' },
    documentKind: { type: 'string' },
    header: {
      type: 'object',
      properties: {
        supplier: { type: 'string' },
        invoiceNo: { type: 'string' },
        date: { type: 'string' },
        subtotalAmount: { type: 'string' },
        taxAmount: { type: 'string' },
        totalAmount: { type: 'string' },
        currency: { type: 'string' },
        notes: { type: 'string' },
      },
      required: [
        'supplier',
        'invoiceNo',
        'date',
        'subtotalAmount',
        'taxAmount',
        'totalAmount',
        'currency',
        'notes',
      ],
    },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          qty: { type: 'string' },
          unit: { type: 'string' },
          unitPrice: { type: 'string' },
          lineTotal: { type: 'string' },
          taxRate: { type: 'string' },
          ingredient: { type: 'string' },
          matched: { type: 'boolean' },
          confidence: { type: 'number' },
          sourceText: { type: 'string' },
        },
        required: [
          'id',
          'name',
          'qty',
          'unit',
          'unitPrice',
          'lineTotal',
          'ingredient',
          'matched',
        ],
      },
    },
    confidence: {
      type: 'object',
      properties: {
        overall: { type: 'number' },
        header: { type: 'number' },
        lineItems: { type: 'number' },
        totals: { type: 'number' },
      },
      required: ['overall', 'header', 'lineItems', 'totals'],
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
    extractedText: { type: 'string' },
    sourcePages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pageNumber: { type: 'integer' },
          kind: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
        },
        required: ['pageNumber', 'kind'],
      },
    },
    provider: { type: 'string' },
    model: { type: 'string' },
  },
  required: [
    'schemaVersion',
    'pageCount',
    'documentKind',
    'header',
    'lineItems',
    'confidence',
    'warnings',
    'provider',
    'model',
  ],
} as const

const confidenceSchema = z.object({
  overall: z.number().min(0).max(1),
  header: z.number().min(0).max(1),
  lineItems: z.number().min(0).max(1),
  totals: z.number().min(0).max(1),
})

export const invoiceExtractionDraftV2Schema = z.object({
  schemaVersion: z.literal(INVOICE_EXTRACTION_SCHEMA_VERSION),
  pageCount: z.number().int().positive(),
  documentKind: z.enum(['pdf', 'image', 'mixed', 'unknown']),
  header: z.object({
    supplier: z.string(),
    invoiceNo: z.string(),
    date: z.string(),
    subtotalAmount: z.string(),
    taxAmount: z.string(),
    totalAmount: z.string(),
    currency: z.string(),
    notes: z.string(),
  }),
  lineItems: z.array(
    z.object({
      id: z.string(),
      name: z.string().min(1),
      qty: z.string(),
      unit: z.string(),
      unitPrice: z.string(),
      lineTotal: z.string(),
      taxRate: z.string().optional(),
      ingredient: z.string(),
      matched: z.boolean(),
      confidence: z.number().min(0).max(1).optional(),
      sourceText: z.string().optional(),
    }),
  ),
  confidence: confidenceSchema,
  warnings: z.array(z.string()),
  extractedText: z.string().optional(),
  sourcePages: z
    .array(
      z.object({
        pageNumber: z.number().int().positive(),
        kind: z.enum(['image', 'pdf-page']),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
})

export type InvoiceExtractionDraftV2 = z.infer<typeof invoiceExtractionDraftV2Schema>

export interface InvoiceExtractionDraft {
  schemaVersion?: typeof INVOICE_EXTRACTION_SCHEMA_VERSION
  pageCount: number
  documentKind?: InvoiceExtractionDraftV2['documentKind']
  header: InvoiceHeaderDraft
  lineItems: InvoiceLineItemDraft[]
  markdownText: string
  provider: string
  model: string
  confidence?: InvoiceExtractionDraftV2['confidence']
  warnings?: string[]
  extractedText?: string
  sourcePages?: InvoiceExtractionDraftV2['sourcePages']
}

export function parseProviderExtractionResponse(input: {
  rawJson: string
  fileName: string
  provider: string
  model: string
}): InvoiceExtractionDraft {
  let parsed: unknown

  try {
    parsed = JSON.parse(input.rawJson)
  } catch (error) {
    throw new Error(
      `Invoice extraction schema validation failed: provider returned invalid JSON (${formatZodError(error)})`,
    )
  }

  const candidate =
    parsed && typeof parsed === 'object'
      ? {
          ...(parsed as Record<string, unknown>),
          provider: input.provider,
          model: input.model,
        }
      : parsed
  const result = invoiceExtractionDraftV2Schema.safeParse(candidate)

  if (!result.success) {
    throw new Error(
      `Invoice extraction schema validation failed: ${formatZodError(result.error)}`,
    )
  }

  return normalizeV2Draft(result.data, input.fileName)
}

export function normalizeV2Draft(
  draft: InvoiceExtractionDraftV2,
  fileName: string,
): InvoiceExtractionDraft {
  const pendingHeader = createFallbackHeader(fileName)
  const normalizedLineItems = draft.lineItems.map((item, index) => ({
    id: item.id.trim() || `${slugifyText(fileName)}-${index + 1}`,
    name: item.name.trim(),
    qty: normalizeNumberText(item.qty),
    unit: item.unit.trim(),
    unitPrice: normalizeMoneyValue(item.unitPrice),
    lineTotal: normalizeMoneyValue(item.lineTotal),
    taxRate: item.taxRate?.trim(),
    ingredient: item.ingredient.trim(),
    matched: Boolean(item.ingredient.trim()) || item.matched,
    confidence: item.confidence,
    sourceText: item.sourceText?.trim(),
  }))
  const header = {
    supplier: draft.header.supplier.trim() || pendingHeader.supplier,
    invoiceNo: draft.header.invoiceNo.trim(),
    date: draft.header.date.trim() || pendingHeader.date,
    totalAmount: normalizeMoneyValue(draft.header.totalAmount),
    taxAmount: normalizeMoneyValue(draft.header.taxAmount),
    notes: draft.header.notes.trim(),
  }

  return {
    schemaVersion: INVOICE_EXTRACTION_SCHEMA_VERSION,
    pageCount: Math.max(1, draft.pageCount),
    documentKind: draft.documentKind,
    header,
    lineItems: normalizedLineItems,
    markdownText: draft.extractedText ?? '',
    provider: draft.provider,
    model: draft.model,
    confidence: draft.confidence,
    warnings: appendTotalWarnings(draft.warnings, header, normalizedLineItems),
    extractedText: draft.extractedText,
    sourcePages: draft.sourcePages,
  }
}

function appendTotalWarnings(
  warnings: string[],
  header: InvoiceHeaderDraft,
  lineItems: InvoiceLineItemDraft[],
) {
  const nextWarnings = [...warnings]
  const totalAmount = parseMoney(header.totalAmount)
  const taxAmount = parseMoney(header.taxAmount)
  const lineTotalSum = lineItems.reduce(
    (sum, item) => sum + (parseMoney(item.lineTotal ?? '') ?? 0),
    0,
  )

  if (
    totalAmount !== null &&
    taxAmount !== null &&
    lineTotalSum > 0 &&
    Math.abs(lineTotalSum + taxAmount - totalAmount) > 0.05
  ) {
    nextWarnings.push(
      `行项目合计 ${lineTotalSum.toFixed(2)} + 税额 ${taxAmount.toFixed(2)} 与总额 ${totalAmount.toFixed(2)} 不一致。`,
    )
  }

  return [...new Set(nextWarnings)]
}

function createFallbackHeader(fileName: string): InvoiceHeaderDraft {
  return {
    supplier: fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(),
    invoiceNo: '',
    date: getMadridTodayInputValue(),
    totalAmount: '',
    taxAmount: '',
    notes: '',
  }
}

function normalizeMoneyValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const lastComma = trimmed.lastIndexOf(',')
  const lastDot = trimmed.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : '.'
  const normalized =
    decimalSeparator === ','
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed.replace(/,/g, '')
  const matchedValue = normalized.match(/-?\d+(?:\.\d{1,4})?/)?.[0]
  return matchedValue ?? ''
}

function parseMoney(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNumberText(value: string) {
  return value.trim().replace(',', '.')
}

function slugifyText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatZodError(error: unknown) {
  return error instanceof z.ZodError
    ? error.issues.map((issue) => issue.path.join('.') || issue.message).join('; ')
    : error instanceof Error
      ? error.message
      : 'unknown error'
}
