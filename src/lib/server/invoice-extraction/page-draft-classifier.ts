import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'

export interface PageDraftResult {
  pageNumber: number
  draft: InvoiceExtractionDraft
  rawResponse: string | null
}

export type PageDraftClassification =
  | { kind: 'single-invoice' }
  | { kind: 'multiple-invoices' }

export function classifyPageDrafts(
  pages: PageDraftResult[],
): PageDraftClassification {
  const invoiceNumbers = new Set<string>()

  for (const page of pages) {
    const invoiceNo = page.draft.header.invoiceNo.trim()
    if (invoiceNo) {
      invoiceNumbers.add(invoiceNo)
    }
  }

  return invoiceNumbers.size > 1
    ? { kind: 'multiple-invoices' }
    : { kind: 'single-invoice' }
}
