import { z } from 'zod'

import {
  getMadridTodayInputValue,
  type InvoiceHeaderDraft,
  type InvoiceLineItemDraft,
} from '@/lib/server/app-domain'

export const INVOICE_EXTRACTION_SCHEMA_VERSION = 'invoice-extraction-v2'
const invoiceDocumentKinds = ['pdf', 'image', 'mixed', 'unknown'] as const
const sourcePageKinds = ['image', 'pdf-page'] as const

export const invoiceExtractionResponseJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'string', enum: [INVOICE_EXTRACTION_SCHEMA_VERSION] },
    pageCount: { type: 'integer' },
    documentKind: { type: 'string', enum: invoiceDocumentKinds },
    header: {
      type: 'object',
      properties: {
        supplier: { type: 'string' },
        supplierTaxId: { type: 'string' },
        supplierAddress: { type: 'string' },
        customerName: { type: 'string' },
        customerTaxId: { type: 'string' },
        customerAddress: { type: 'string' },
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
          notes: { type: 'string' },
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
          kind: { type: 'string', enum: sourcePageKinds },
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

type NormalizedInvoiceDocumentKind = (typeof invoiceDocumentKinds)[number]
type NormalizedSourcePageKind = (typeof sourcePageKinds)[number]

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
    supplierTaxId: z.string().optional(),
    supplierAddress: z.string().optional(),
    customerName: z.string().optional(),
    customerTaxId: z.string().optional(),
    customerAddress: z.string().optional(),
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
      notes: z.string().optional(),
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
  documentKind?: NormalizedInvoiceDocumentKind
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
      ? normalizeProviderOwnedMetadata(parsed as Record<string, unknown>, input)
      : parsed
  const result = invoiceExtractionDraftV2Schema.safeParse(candidate)

  if (!result.success) {
    throw new Error(
      `Invoice extraction schema validation failed: ${formatZodError(result.error)}`,
    )
  }

  return normalizeV2Draft(result.data, input.fileName)
}

function normalizeProviderOwnedMetadata(
  value: Record<string, unknown>,
  input: {
    fileName: string
    provider: string
    model: string
    documentKind?: NormalizedInvoiceDocumentKind
  },
) {
  const documentKind =
    normalizeInvoiceDocumentKind(value.documentKind) ??
    input.documentKind ??
    inferDocumentKindFromFileName(input.fileName)

  return {
    ...value,
    schemaVersion: INVOICE_EXTRACTION_SCHEMA_VERSION,
    documentKind,
    sourcePages: normalizeSourcePages(value.sourcePages, documentKind),
    provider: input.provider,
    model: input.model,
  }
}

function normalizeInvoiceDocumentKind(
  value: unknown,
): NormalizedInvoiceDocumentKind | undefined {
  return invoiceDocumentKinds.includes(value as NormalizedInvoiceDocumentKind)
    ? (value as NormalizedInvoiceDocumentKind)
    : undefined
}

function inferDocumentKindFromFileName(fileName: string): NormalizedInvoiceDocumentKind {
  if (/\.pdf$/i.test(fileName)) return 'pdf'
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)$/i.test(fileName)) return 'image'
  return 'unknown'
}

function normalizeSourcePages(
  value: unknown,
  documentKind: NormalizedInvoiceDocumentKind,
) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const sourcePages = value
    .map((item) => normalizeSourcePage(item, documentKind))
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return sourcePages.length > 0 ? sourcePages : undefined
}

function normalizeSourcePage(
  value: unknown,
  documentKind: NormalizedInvoiceDocumentKind,
) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const sourcePage = value as Record<string, unknown>
  const pageNumber =
    typeof sourcePage.pageNumber === 'number' && Number.isFinite(sourcePage.pageNumber)
      ? Math.round(sourcePage.pageNumber)
      : null
  const kind = normalizeSourcePageKind(sourcePage.kind, documentKind)

  if (!pageNumber || pageNumber < 1 || !kind) {
    return null
  }

  return {
    pageNumber,
    kind,
    width:
      typeof sourcePage.width === 'number' && Number.isFinite(sourcePage.width)
        ? Math.round(sourcePage.width)
        : undefined,
    height:
      typeof sourcePage.height === 'number' && Number.isFinite(sourcePage.height)
        ? Math.round(sourcePage.height)
        : undefined,
  }
}

function normalizeSourcePageKind(
  value: unknown,
  documentKind: NormalizedInvoiceDocumentKind,
): NormalizedSourcePageKind | undefined {
  if (value === 'image' || value === 'photo') return 'image'
  if (value === 'pdf-page' || value === 'pdf' || value === 'page') return 'pdf-page'
  if (documentKind === 'image') return 'image'
  if (documentKind === 'pdf' || documentKind === 'mixed') return 'pdf-page'
  return undefined
}

export function normalizeV2Draft(
  draft: InvoiceExtractionDraftV2,
  fileName: string,
): InvoiceExtractionDraft {
  const pendingHeader = createFallbackHeader(fileName)
  const totalAmount = normalizeMoneyValue(draft.header.totalAmount)
  const subtotalAmount = normalizeMoneyValue(draft.header.subtotalAmount)
  const lineTotalCandidates = draft.lineItems.map((item) => {
    const normalizedLineTotal = normalizeMoneyValue(item.lineTotal)
    const grossedLineTotal = calculateTaxIncludedLineTotal(
      normalizedLineTotal,
      item.taxRate,
    )

    return {
      rawLineTotal: normalizedLineTotal,
      grossedLineTotal,
    }
  })
  const shouldGrossLineTotals = shouldGrossLineTotalsFromTax({
    subtotalAmount,
    totalAmount,
    lineTotalCandidates,
  })
  const normalizedLineItems = draft.lineItems.map((item, index) => {
    const taxIncludedLineTotal = shouldGrossLineTotals
      ? lineTotalCandidates[index]?.grossedLineTotal ?? ''
      : lineTotalCandidates[index]?.rawLineTotal ?? ''
    const normalizedQty = normalizeNumberText(item.qty)

    return {
      id: item.id.trim() || `${slugifyText(fileName)}-${index + 1}`,
      name: item.name.trim(),
      qty: normalizedQty,
      unit: item.unit.trim(),
      unitPrice: calculateTaxIncludedUnitPrice({
        qty: normalizedQty,
        unitPrice: normalizeMoneyValue(item.unitPrice),
        lineTotal: taxIncludedLineTotal,
        taxRate: shouldGrossLineTotals ? item.taxRate : undefined,
      }),
      lineTotal: taxIncludedLineTotal,
      taxRate: item.taxRate?.trim(),
      notes: item.notes?.trim() || undefined,
      ingredient: '',
      matched: false,
      confidence: item.confidence,
      sourceText: item.sourceText?.trim(),
    }
  })
  const header = {
    supplier: draft.header.supplier.trim() || pendingHeader.supplier,
    supplierTaxId: draft.header.supplierTaxId?.trim(),
    supplierAddress: draft.header.supplierAddress?.trim(),
    customerName: draft.header.customerName?.trim(),
    customerTaxId: draft.header.customerTaxId?.trim(),
    customerAddress: draft.header.customerAddress?.trim(),
    invoiceNo: draft.header.invoiceNo.trim(),
    date: draft.header.date.trim() || pendingHeader.date,
    totalAmount,
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

function shouldGrossLineTotalsFromTax(input: {
  subtotalAmount: string
  totalAmount: string
  lineTotalCandidates: Array<{
    rawLineTotal: string
    grossedLineTotal: string
  }>
}) {
  const subtotalAmount = parseMoney(input.subtotalAmount)
  const totalAmount = parseMoney(input.totalAmount)
  const rawLineTotalSum = sumMoneyValues(
    input.lineTotalCandidates.map((item) => item.rawLineTotal),
  )
  if (rawLineTotalSum <= 0) {
    return false
  }

  const grossedLineTotalSum = sumMoneyValues(
    input.lineTotalCandidates.map((item) => item.grossedLineTotal),
  )
  const rawTotalDelta =
    totalAmount === null ? null : Math.abs(rawLineTotalSum - totalAmount)
  const grossedTotalDelta =
    totalAmount === null ? null : Math.abs(grossedLineTotalSum - totalAmount)

  if (
    rawTotalDelta !== null &&
    grossedTotalDelta !== null &&
    rawTotalDelta <= 0.05 &&
    rawTotalDelta <= grossedTotalDelta
  ) {
    return false
  }

  const rawSubtotalDelta =
    subtotalAmount === null ? null : Math.abs(rawLineTotalSum - subtotalAmount)
  if (rawSubtotalDelta !== null && rawSubtotalDelta <= 0.05) {
    return (
      grossedTotalDelta === null ||
      grossedTotalDelta <= 0.05 ||
      (rawTotalDelta !== null && grossedTotalDelta < rawTotalDelta)
    )
  }

  return (
    rawTotalDelta !== null &&
    grossedTotalDelta !== null &&
    grossedTotalDelta <= 0.05 &&
    grossedTotalDelta < rawTotalDelta
  )
}

function sumMoneyValues(values: string[]) {
  return values.reduce((sum, value) => sum + (parseMoney(value) ?? 0), 0)
}

function appendTotalWarnings(
  warnings: string[],
  header: InvoiceHeaderDraft,
  lineItems: InvoiceLineItemDraft[],
) {
  const nextWarnings = [...warnings]
  const totalAmount = parseMoney(header.totalAmount)
  const lineTotalSum = sumMoneyValues(lineItems.map((item) => item.lineTotal ?? ''))

  if (
    totalAmount !== null &&
    lineTotalSum > 0 &&
    Math.abs(lineTotalSum - totalAmount) > 0.05
  ) {
    nextWarnings.push(
      `行项目含税合计 ${lineTotalSum.toFixed(2)} 与总额 ${totalAmount.toFixed(2)} 不一致。`,
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

function parseTaxRate(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed.replace(',', '.')
  const percentage = normalized.match(/(\d+(?:\.\d+)?)/)?.[1]
  if (!percentage) {
    return null
  }

  const parsed = Number.parseFloat(percentage)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return normalized.includes('%') || parsed > 1 ? parsed / 100 : parsed
}

function formatMoney(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function calculateTaxIncludedLineTotal(lineTotal: string, taxRate: string | undefined) {
  const parsedLineTotal = parseMoney(lineTotal)
  const parsedTaxRate = parseTaxRate(taxRate)

  if (parsedLineTotal === null) {
    return ''
  }

  if (parsedTaxRate === null) {
    return formatMoney(parsedLineTotal)
  }

  return formatMoney(parsedLineTotal * (1 + parsedTaxRate))
}

function calculateTaxIncludedUnitPrice(input: {
  qty: string
  unitPrice: string
  lineTotal: string
  taxRate?: string
}) {
  const quantity = parseMoney(input.qty)
  const taxIncludedLineTotal = parseMoney(input.lineTotal)

  if (quantity !== null && quantity > 0 && taxIncludedLineTotal !== null) {
    return formatMoney(taxIncludedLineTotal / quantity)
  }

  const parsedUnitPrice = parseMoney(input.unitPrice)
  const parsedTaxRate = parseTaxRate(input.taxRate)
  if (parsedUnitPrice === null) {
    return ''
  }

  return formatMoney(
    parsedTaxRate === null ? parsedUnitPrice : parsedUnitPrice * (1 + parsedTaxRate),
  )
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
