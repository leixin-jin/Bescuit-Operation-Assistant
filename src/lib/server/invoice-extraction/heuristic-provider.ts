import { getMadridTodayInputValue, type InvoiceLineItemDraft } from '@/lib/server/app-domain'
import type { InvoiceExtractionProvider } from '@/lib/server/invoice-extraction/providers'
import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'

export function createHeuristicInvoiceExtractionProvider(input: {
  model: string
}): InvoiceExtractionProvider {
  return {
    id: 'heuristic-v1',
    model: input.model,
    async extract(providerInput) {
      const draft = extractInvoiceReviewDraft({
        fileName: providerInput.fileName,
        markdownText: '',
        provider: 'heuristic-v1',
        model: input.model,
      })

      return {
        draft,
        rawResponse: JSON.stringify({
          provider: 'heuristic-v1',
          source: 'filename-fallback',
          documentKind: providerInput.documentKind,
        }),
      }
    },
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
        : pendingDraft.lineItems.map((item) => ({ ...item })),
    markdownText,
    provider: input.provider,
    model: input.model,
    confidence: {
      overall: calculateHeuristicConfidence({
        header: {
          supplier: extractedSupplier,
          invoiceNo: extractedInvoiceNo,
          date: extractedDate ?? '',
          totalAmount: extractedTotalAmount,
          taxAmount: extractedTaxAmount,
        },
        hasLineItems: extractedLineItems.length > 0,
      }),
      header: 0.35,
      lineItems: extractedLineItems.length > 0 ? 0.35 : 0,
      totals: extractedTotalAmount ? 0.35 : 0,
    },
    warnings: ['启发式抽取仅用于本地开发或显式 fallback，请人工核对全部字段。'],
  }
}

function createPendingExtractionDraft(fileName: string): InvoiceExtractionDraft {
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

function calculateHeuristicConfidence(input: {
  header: Record<string, string>
  hasLineItems: boolean
}) {
  const completedHeaderCount = Object.values(input.header).filter(
    (value) => value.trim().length > 0,
  ).length

  return Math.min(
    1,
    Number(((completedHeaderCount + (input.hasLineItems ? 1 : 0)) / 6).toFixed(2)),
  )
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
