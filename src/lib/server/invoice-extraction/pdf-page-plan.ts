import type { InvoiceExtractionProviderResult } from '@/lib/server/invoice-extraction/providers'
import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'

export interface PageExtractionResult {
  pageNumber: number
  draft: InvoiceExtractionDraft
  rawResponse: string | null
}

export function splitPageDraftsIntoProviderResult(
  pages: PageExtractionResult[],
): InvoiceExtractionProviderResult {
  const [primary, ...additional] = pages

  if (!primary) {
    throw new Error('Page-wise invoice extraction returned no page drafts')
  }

  return {
    draft: primary.draft,
    rawResponse: primary.rawResponse,
    additionalDrafts: additional.map((page) => ({
      pageNumber: page.pageNumber,
      draft: page.draft,
      rawResponse: page.rawResponse,
    })),
  }
}
