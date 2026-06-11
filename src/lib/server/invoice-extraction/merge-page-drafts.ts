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
  if (pages.length === 0) {
    throw new Error('Page-wise invoice extraction returned no page drafts')
  }

  const classification = classifyPageDrafts(pages)
  const classifiedPages = classification.pages
  const [primary, ...additional] = classifiedPages

  if (!primary) {
    throw new Error('Page-wise invoice extraction returned no page drafts')
  }

  const rawResponse = buildPageWiseRawResponse(classifiedPages, classification.kind)

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

  const totalsPage = findLastPageWithTotal(classifiedPages) ?? primary
  const totalsHeader = totalsPage.draft.header as HeaderWithCurrency
  const primaryHeader = primary.draft.header as HeaderWithCurrency
  const currency = totalsHeader.currency?.trim() || primaryHeader.currency?.trim()
  const mergedHeader: HeaderWithCurrency = {
    ...primary.draft.header,
    subtotalAmount: totalsHeader.subtotalAmount,
    taxAmount: totalsHeader.taxAmount,
    totalAmount: totalsHeader.totalAmount,
  }

  if (currency) {
    mergedHeader.currency = currency
  }

  return {
    draft: {
      ...primary.draft,
      pageCount: classifiedPages.length,
      header: mergedHeader,
      lineItems: classifiedPages.flatMap((page) => page.draft.lineItems),
      markdownText: classifiedPages
        .map((page) => page.draft.markdownText.trim())
        .filter(Boolean)
        .join('\n\n'),
      warnings: classifiedPages.flatMap((page) => page.draft.warnings ?? []),
      extractedText: classifiedPages
        .map((page) => page.draft.extractedText?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n') || undefined,
      sourcePages: classifiedPages.map((page) => ({
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
