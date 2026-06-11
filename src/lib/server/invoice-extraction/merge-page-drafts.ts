import type { InvoiceExtractionProviderResult } from '@/lib/server/invoice-extraction/providers'
import {
  classifyPageDrafts,
  type PageDraftResult,
} from '@/lib/server/invoice-extraction/page-draft-classifier'

type HeaderWithCurrency = PageDraftResult['draft']['header'] & {
  currency?: string
}

export function splitPageDraftsIntoProviderResult(
  pages: PageDraftResult[],
): InvoiceExtractionProviderResult {
  const [primary, ...additional] = pages

  if (!primary) {
    throw new Error('Page-wise invoice extraction returned no page drafts')
  }

  const classification = classifyPageDrafts(pages)
  const rawResponse = buildPageWiseRawResponse(pages, classification.kind)

  if (classification.kind === 'multiple-invoices') {
    return {
      draft: primary.draft,
      rawResponse,
      additionalDrafts: additional.map((page) => ({
        pageNumber: page.pageNumber,
        draft: page.draft,
        rawResponse: page.rawResponse,
      })),
    }
  }

  const totalsPage = findLastPageWithTotal(pages) ?? primary
  const totalsHeader = totalsPage.draft.header as HeaderWithCurrency
  const primaryHeader = primary.draft.header as HeaderWithCurrency
  const currency = totalsHeader.currency?.trim() || primaryHeader.currency?.trim()
  const mergedHeader: HeaderWithCurrency = {
    ...primary.draft.header,
    totalAmount: totalsPage.draft.header.totalAmount,
    taxAmount: totalsPage.draft.header.taxAmount,
  }

  if (currency) {
    mergedHeader.currency = currency
  }

  return {
    draft: {
      ...primary.draft,
      pageCount: pages.length,
      header: mergedHeader,
      lineItems: pages.flatMap((page) => page.draft.lineItems),
      markdownText: pages
        .map((page) => page.draft.markdownText.trim())
        .filter(Boolean)
        .join('\n\n'),
      warnings: pages.flatMap((page) => page.draft.warnings ?? []),
      extractedText: pages
        .map((page) => page.draft.extractedText?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n') || undefined,
      sourcePages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        kind: 'pdf-page' as const,
      })),
    },
    rawResponse,
  }
}

function findLastPageWithTotal(pages: PageDraftResult[]) {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page?.draft.header.totalAmount.trim()) {
      return page
    }
  }

  return null
}

function buildPageWiseRawResponse(
  pages: PageDraftResult[],
  classification: 'single-invoice' | 'multiple-invoices',
) {
  return JSON.stringify({
    pageWise: true,
    classification,
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      rawResponse: page.rawResponse,
    })),
  })
}
