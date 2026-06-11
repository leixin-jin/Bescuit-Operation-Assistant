import { describe, expect, test, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

import {
  buildInvoiceProviderInput,
  buildInvoiceReviewJob,
  extractInvoiceReviewDraft,
  getExtractionResultId,
  isTerminalIntakeStage,
  mapIntakeStageToInvoiceStatus,
  parseProviderExtractionResponse,
  parseStoredExtractionDraft,
  selectInvoiceExtractionProvider,
  serializeExtractionDraft,
} from '@/lib/server/extraction'
import { getInvoiceJobStage, getInvoiceStatusLabel, isInvoiceJobProcessing } from '@/lib/server/app-domain'
import { createGeminiInvoiceExtractionProvider } from '@/lib/server/invoice-extraction/gemini-provider'
import { splitPageDraftsIntoProviderResult } from '@/lib/server/invoice-extraction/merge-page-drafts'
import { classifyPageDrafts } from '@/lib/server/invoice-extraction/page-draft-classifier'
import { splitPdfIntoPageInputs } from '@/lib/server/invoice-extraction/pdf-page-plan'
import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'

type HeaderWithTotals = InvoiceExtractionDraft['header'] & {
  subtotalAmount: string
  currency: string
}

function makeDraft(input: {
  invoiceNo: string
  totalAmount: string
}): InvoiceExtractionDraft {
  return {
    schemaVersion: 'invoice-extraction-v2',
    pageCount: 1,
    documentKind: 'pdf',
    header: {
      supplier: 'Proveedor SL',
      invoiceNo: input.invoiceNo,
      date: '2026-05-31',
      totalAmount: input.totalAmount,
      taxAmount: '',
      notes: '',
    },
    lineItems: [
      {
        id: `item-${input.invoiceNo || 'blank'}`,
        name: 'Producto',
        qty: '1',
        unit: 'ud',
        unitPrice: input.totalAmount,
        lineTotal: input.totalAmount,
        ingredient: '',
        matched: false,
      },
    ],
    markdownText: '',
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
    warnings: [],
    sourcePages: [{ pageNumber: 1, kind: 'pdf-page' }],
  }
}

describe('invoice extraction helpers', () => {
  test('sends Gemini structured output fields accepted by generateContent REST API', async () => {
    const responseJson = {
      schemaVersion: 'invoice-extraction-v2',
      pageCount: 1,
      documentKind: 'image',
      header: {
        supplier: 'Proveedor SL',
        invoiceNo: 'F-100',
        date: '2026-04-18',
        subtotalAmount: '80.00',
        taxAmount: '16.80',
        totalAmount: '96.80',
        currency: 'EUR',
        notes: '',
      },
      lineItems: [
        {
          id: 'item-1',
          name: 'Tomate',
          qty: '10',
          unit: 'kg',
          unitPrice: '2.00',
          lineTotal: '20.00',
          ingredient: '',
          matched: false,
        },
      ],
      confidence: {
        overall: 0.81,
        header: 0.9,
        lineItems: 0.7,
        totals: 0.83,
      },
      warnings: [],
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(responseJson) }],
              },
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = createGeminiInvoiceExtractionProvider({
        apiKey: 'test-key',
        model: 'gemini-3.5-flash',
        timeoutMs: 1000,
      })

      await provider.extract({
        fileName: 'factura.jpg',
        mimeType: 'image/jpeg',
        arrayBuffer: new ArrayBuffer(0),
        size: 0,
        base64: 'ZmFrZQ==',
        dataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
        documentKind: 'image',
      })

      const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
      const promptText = requestBody.contents[0].parts
        .map((part: { text?: string }) => part.text ?? '')
        .join('\n')

      expect(promptText).toContain('tax-included')
      expect(promptText).toContain('lineItems[].notes')
      expect(promptText).toContain('lineItems[].taxRate')
      expect(promptText).toContain('lineTotal = net line total * (1 + IVA rate)')
      expect(promptText).toContain('ingredient must be an empty string')
      expect(requestBody.generationConfig).toMatchObject({
        responseMimeType: 'application/json',
        responseSchema: expect.objectContaining({
          type: 'object',
        }),
      })
      expect(requestBody.generationConfig).not.toHaveProperty('responseFormat')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('builds provider input from original image bytes without markdown', async () => {
    const input = await buildInvoiceProviderInput({
      fileName: 'ticket.jpg',
      mimeType: 'image/jpeg',
      arrayBuffer: new TextEncoder().encode('fake-image').buffer,
    })

    expect(input.documentKind).toBe('image')
    expect(input.base64).toBe('ZmFrZS1pbWFnZQ==')
    expect(input.dataUrl).toBe('data:image/jpeg;base64,ZmFrZS1pbWFnZQ==')
    expect(input).not.toHaveProperty('markdownText')
  })

  test('splits a PDF into one provider input per page', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 100])
    pdf.addPage([100, 100])
    const pdfBytes = await pdf.save()
    const arrayBuffer = uint8ArrayToArrayBuffer(pdfBytes)
    const input = await buildInvoiceProviderInput({
      fileName: 'two-page.pdf',
      mimeType: 'application/pdf',
      arrayBuffer,
    })

    const pages = await splitPdfIntoPageInputs(input)

    expect(pages).toHaveLength(2)
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2])
    for (const page of pages) {
      expect(page.fileName).toBe('two-page.pdf')
      expect(page.mimeType).toBe('application/pdf')
      expect(page.documentKind).toBe('pdf')
      expect(page.size).toBe(page.arrayBuffer.byteLength)
      expect(page.base64.length).toBeGreaterThan(0)
      expect(page.dataUrl).toBe(`data:application/pdf;base64,${page.base64}`)
      const pagePdf = await PDFDocument.load(page.arrayBuffer)
      expect(pagePdf.getPageCount()).toBe(1)
    }
  })

  test('selects Gemini provider from configured extraction env', () => {
    const provider = selectInvoiceExtractionProvider({
      INVOICE_EXTRACTION_PROVIDER: 'gemini',
      INVOICE_EXTRACTION_MODEL: 'gemini-3.5-flash',
      GEMINI_API_KEY: 'test-key',
    })

    expect(provider.id).toBe('gemini')
    expect(provider.model).toBe('gemini-3.5-flash')
  })

  test('selects Gemini provider with page-wise PDF mode enabled', () => {
    const provider = selectInvoiceExtractionProvider({
      INVOICE_EXTRACTION_PROVIDER: 'gemini',
      INVOICE_EXTRACTION_MODEL: 'gemini-3.5-flash',
      INVOICE_PDF_INPUT_MODE: 'page-wise',
      GEMINI_API_KEY: 'test-key',
    })

    expect(provider.id).toBe('gemini')
    expect(provider.model).toBe('gemini-3.5-flash')
    expect(provider).toHaveProperty('pdfInputMode', 'page-wise')
  })

  test('selected page-wise Gemini provider splits PDF pages by default', async () => {
    const responseFor = (invoiceNo: string, pageNumber: number) => ({
      schemaVersion: 'invoice-extraction-v2',
      pageCount: 1,
      documentKind: 'pdf',
      sourcePages: [{ pageNumber, kind: 'pdf-page' }],
      header: {
        supplier: 'Emcadi S.A.',
        invoiceNo,
        date: '2026-05-31',
        subtotalAmount: '',
        taxAmount: '',
        totalAmount: '1.00',
        currency: 'EUR',
        notes: '',
      },
      lineItems: [
        {
          id: `item-${pageNumber}`,
          name: `Page ${pageNumber} item`,
          qty: '1',
          unit: 'ud',
          unitPrice: '1.00',
          lineTotal: '1.00',
          ingredient: '',
          matched: false,
        },
      ],
      confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
      warnings: [],
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(responseFor('page-1', 1)) }] } }],
        })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(responseFor('page-2', 2)) }] } }],
        })),
      )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = selectInvoiceExtractionProvider({
        INVOICE_EXTRACTION_PROVIDER: 'gemini',
        INVOICE_EXTRACTION_MODEL: 'gemini-3.5-flash',
        INVOICE_PDF_INPUT_MODE: 'page-wise',
        GEMINI_API_KEY: 'test-key',
      })
      const pdf = await PDFDocument.create()
      pdf.addPage([100, 100])
      pdf.addPage([100, 100])
      const pdfBytes = await pdf.save()
      const arrayBuffer = uint8ArrayToArrayBuffer(pdfBytes)
      const input = await buildInvoiceProviderInput({
        fileName: 'two-page.pdf',
        mimeType: 'application/pdf',
        arrayBuffer,
      })

      const result = await provider.extract(input)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.draft.header.invoiceNo).toBe('page-1')
      expect(result.additionalDrafts?.[0]?.draft.header.invoiceNo).toBe('page-2')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('page-wise Gemini extraction sends one request per PDF page input', async () => {
    const responseFor = (invoiceNo: string, totalAmount: string, pageNumber: number) => ({
      schemaVersion: 'invoice-extraction-v2',
      pageCount: 1,
      documentKind: 'pdf',
      sourcePages: [{ pageNumber, kind: 'pdf-page' }],
      header: {
        supplier: 'Emcadi S.A.',
        invoiceNo,
        date: '2026-05-31',
        subtotalAmount: '',
        taxAmount: '',
        totalAmount,
        currency: 'EUR',
        notes: '',
      },
      lineItems: [
        {
          id: `item-${pageNumber}`,
          name: `Page ${pageNumber} item`,
          qty: '1',
          unit: 'ud',
          unitPrice: totalAmount,
          lineTotal: totalAmount,
          ingredient: '',
          matched: false,
        },
      ],
      confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
      warnings: [],
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(responseFor('2605A008462', '769.22', 1)) }] } }],
        })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(responseFor('2605A008463', '733.15', 2)) }] } }],
        })),
      )

    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = createGeminiInvoiceExtractionProvider({
        apiKey: 'test-key',
        model: 'gemini-3.5-flash',
        timeoutMs: 1000,
        pdfInputMode: 'page-wise',
        splitPdfPages: async () => [
          {
            fileName: '2605A008462-2605A008463.PDF',
            mimeType: 'application/pdf',
            arrayBuffer: new TextEncoder().encode('page-1').buffer,
            size: 6,
            base64: 'cGFnZS0x',
            dataUrl: 'data:application/pdf;base64,cGFnZS0x',
            documentKind: 'pdf',
            pageNumber: 1,
          },
          {
            fileName: '2605A008462-2605A008463.PDF',
            mimeType: 'application/pdf',
            arrayBuffer: new TextEncoder().encode('page-2').buffer,
            size: 6,
            base64: 'cGFnZS0y',
            dataUrl: 'data:application/pdf;base64,cGFnZS0y',
            documentKind: 'pdf',
            pageNumber: 2,
          },
        ],
      })

      const result = await provider.extract({
        fileName: '2605A008462-2605A008463.PDF',
        mimeType: 'application/pdf',
        arrayBuffer: new TextEncoder().encode('whole-pdf').buffer,
        size: 9,
        base64: 'd2hvbGUtcGRm',
        dataUrl: 'data:application/pdf;base64,d2hvbGUtcGRm',
        documentKind: 'pdf',
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const firstRequestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
      const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)
      expect(firstRequestBody.contents[0].parts[0].inline_data.data).toBe('cGFnZS0x')
      expect(secondRequestBody.contents[0].parts[0].inline_data.data).toBe('cGFnZS0y')
      expect(result.draft.header.invoiceNo).toBe('2605A008462')
      expect(result.additionalDrafts).toHaveLength(1)
      expect(result.additionalDrafts?.[0]?.draft.header.invoiceNo).toBe('2605A008463')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('page-wise Gemini extraction merges page drafts with the same invoice number', async () => {
    const responseFor = (
      totals: { subtotalAmount: string; taxAmount: string; totalAmount: string },
      pageNumber: number,
      currency = 'EUR',
    ) => ({
      schemaVersion: 'invoice-extraction-v2',
      pageCount: 1,
      documentKind: 'pdf',
      sourcePages: [{ pageNumber, kind: 'pdf-page' }],
      header: {
        supplier: 'Emcadi S.A.',
        invoiceNo: 'F-100',
        date: '2026-05-31',
        subtotalAmount: totals.subtotalAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        currency,
        notes: '',
      },
      lineItems: [
        {
          id: `item-${pageNumber}`,
          name: `Page ${pageNumber} item`,
          qty: '1',
          unit: 'ud',
          unitPrice: totals.totalAmount || '1.00',
          lineTotal: totals.totalAmount || '1.00',
          ingredient: '',
          matched: false,
        },
      ],
      confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
      warnings: pageNumber === 2 ? ['Check page 2 total'] : [],
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify(responseFor(
                  { subtotalAmount: '40.00', taxAmount: '', totalAmount: '' },
                  1,
                )),
              }],
            },
          }],
        })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify(responseFor(
                  { subtotalAmount: '100.00', taxAmount: '20.00', totalAmount: '120.00' },
                  2,
                  '',
                )),
              }],
            },
          }],
        })),
      )

    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = createGeminiInvoiceExtractionProvider({
        apiKey: 'test-key',
        model: 'gemini-3.5-flash',
        timeoutMs: 1000,
        pdfInputMode: 'page-wise',
        splitPdfPages: async () => [
          {
            fileName: 'f-100.pdf',
            mimeType: 'application/pdf',
            arrayBuffer: new TextEncoder().encode('page-1').buffer,
            size: 6,
            base64: 'cGFnZS0x',
            dataUrl: 'data:application/pdf;base64,cGFnZS0x',
            documentKind: 'pdf',
            pageNumber: 1,
          },
          {
            fileName: 'f-100.pdf',
            mimeType: 'application/pdf',
            arrayBuffer: new TextEncoder().encode('page-2').buffer,
            size: 6,
            base64: 'cGFnZS0y',
            dataUrl: 'data:application/pdf;base64,cGFnZS0y',
            documentKind: 'pdf',
            pageNumber: 2,
          },
        ],
      })

      const result = await provider.extract({
        fileName: 'f-100.pdf',
        mimeType: 'application/pdf',
        arrayBuffer: new TextEncoder().encode('whole-pdf').buffer,
        size: 9,
        base64: 'd2hvbGUtcGRm',
        dataUrl: 'data:application/pdf;base64,d2hvbGUtcGRm',
        documentKind: 'pdf',
      })

      expect(result.additionalDrafts).toBeUndefined()
      expect(result.draft.header.invoiceNo).toBe('F-100')
      expect(result.draft.header.taxAmount).toBe('20.00')
      expect(result.draft.header.totalAmount).toBe('120.00')
      expect(result.draft.pageCount).toBe(2)
      expect(result.draft.lineItems.map((item) => item.id)).toEqual(['item-1', 'item-2'])
      expect(result.draft.sourcePages).toEqual([
        { pageNumber: 1, kind: 'pdf-page' },
        { pageNumber: 2, kind: 'pdf-page' },
      ])
      expect(result.draft.warnings).toEqual(['Check page 2 total'])
      expect(result.rawResponse ? JSON.parse(result.rawResponse) : null).toMatchObject({
        pageWise: true,
        pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('page-wise Gemini extraction merges page drafts using all totals fields from the last totals page', () => {
    const firstPage = makeDraft({ invoiceNo: 'F-100', totalAmount: '' })
    const secondPage = makeDraft({ invoiceNo: 'F-100', totalAmount: '120.00' })

    firstPage.header = {
      ...firstPage.header,
      subtotalAmount: '40.00',
      taxAmount: '',
      currency: 'EUR',
    } as HeaderWithTotals
    secondPage.header = {
      ...secondPage.header,
      subtotalAmount: '100.00',
      taxAmount: '20.00',
      currency: '',
    } as HeaderWithTotals

    const result = splitPageDraftsIntoProviderResult([
      { pageNumber: 1, draft: firstPage, rawResponse: '{}' },
      { pageNumber: 2, draft: secondPage, rawResponse: '{}' },
    ])

    const header = result.draft.header as HeaderWithTotals
    expect(header.subtotalAmount).toBe('100.00')
    expect(header.taxAmount).toBe('20.00')
    expect(header.totalAmount).toBe('120.00')
    expect(header.currency).toBe('EUR')
  })

  test('classifies page drafts with different invoice numbers as separate invoices', () => {
    const result = classifyPageDrafts([
      { pageNumber: 1, draft: makeDraft({ invoiceNo: '2605A008462', totalAmount: '769.22' }), rawResponse: '{}' },
      { pageNumber: 2, draft: makeDraft({ invoiceNo: '2605A008463', totalAmount: '733.15' }), rawResponse: '{}' },
    ])
    expect(result.kind).toBe('multiple-invoices')
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]?.draft.header.invoiceNo).toBe('2605A008462')
  })

  test('classifies page drafts with the same invoice number as one invoice', () => {
    const result = classifyPageDrafts([
      { pageNumber: 1, draft: makeDraft({ invoiceNo: 'F-100', totalAmount: '' }), rawResponse: '{}' },
      { pageNumber: 2, draft: makeDraft({ invoiceNo: 'F-100', totalAmount: '120.00' }), rawResponse: '{}' },
    ])
    expect(result.kind).toBe('single-invoice')
    expect(result.pages).toHaveLength(2)
    expect(result.pages[1]?.draft.header.totalAmount).toBe('120.00')
  })

  test('page-wise Gemini extraction includes page number when a page fails schema validation', async () => {
    const validResponse = {
      schemaVersion: 'invoice-extraction-v2',
      pageCount: 1,
      documentKind: 'pdf',
      sourcePages: [{ pageNumber: 1, kind: 'pdf-page' }],
      header: {
        supplier: 'Emcadi S.A.',
        invoiceNo: '2605A008462',
        date: '2026-05-31',
        subtotalAmount: '',
        taxAmount: '',
        totalAmount: '769.22',
        currency: 'EUR',
        notes: '',
      },
      lineItems: [
        {
          id: 'item-1',
          name: 'Page 1 item',
          qty: '1',
          unit: 'ud',
          unitPrice: '769.22',
          lineTotal: '769.22',
          ingredient: '',
          matched: false,
        },
      ],
      confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
      warnings: [],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(validResponse) }] } }],
        })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ schemaVersion: 'invoice-extraction-v2' }) }] } }],
        })),
      )

    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = createGeminiInvoiceExtractionProvider({
        apiKey: 'test-key',
        model: 'gemini-3.5-flash',
        timeoutMs: 1000,
        pdfInputMode: 'page-wise',
        splitPdfPages: async () => [
          {
            fileName: 'two-page.pdf',
            mimeType: 'application/pdf',
            arrayBuffer: new TextEncoder().encode('page-1').buffer,
            size: 6,
            base64: 'cGFnZS0x',
            dataUrl: 'data:application/pdf;base64,cGFnZS0x',
            documentKind: 'pdf',
            pageNumber: 1,
          },
          {
            fileName: 'two-page.pdf',
            mimeType: 'application/pdf',
            arrayBuffer: new TextEncoder().encode('page-2').buffer,
            size: 6,
            base64: 'cGFnZS0y',
            dataUrl: 'data:application/pdf;base64,cGFnZS0y',
            documentKind: 'pdf',
            pageNumber: 2,
          },
        ],
      })

      await expect(provider.extract({
        fileName: 'two-page.pdf',
        mimeType: 'application/pdf',
        arrayBuffer: new TextEncoder().encode('whole-pdf').buffer,
        size: 9,
        base64: 'd2hvbGUtcGRm',
        dataUrl: 'data:application/pdf;base64,d2hvbGUtcGRm',
        documentKind: 'pdf',
      })).rejects.toThrow(/PDF page 2/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('rejects provider JSON that does not match v2 schema', () => {
    expect(() =>
      parseProviderExtractionResponse({
        rawJson: JSON.stringify({
          schemaVersion: 'invoice-extraction-v2',
          header: { supplier: 'Missing totals' },
          lineItems: [],
        }),
        fileName: 'bad.pdf',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
    ).toThrow(/schema/i)
  })

  test('normalizes provider-owned metadata before validating Gemini JSON', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        pageCount: 2,
        documentKind: 'invoice',
        header: {
          supplier: 'Proveedor SL',
          invoiceNo: 'F-101',
          date: '2026-05-08',
          subtotalAmount: '40.00',
          taxAmount: '8.40',
          totalAmount: '48.40',
          currency: 'EUR',
          notes: '',
        },
        lineItems: [
          {
            id: 'item-1',
            name: 'Aceite',
            qty: '2',
            unit: 'l',
            unitPrice: '20.00',
            lineTotal: '40.00',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.8,
          header: 0.9,
          lineItems: 0.75,
          totals: 0.85,
        },
        warnings: [],
        sourcePages: [
          { pageNumber: 1, kind: 'pdf' },
          { pageNumber: 2, kind: 'page' },
        ],
      }),
      fileName: 'factura.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      documentKind: 'pdf',
    })

    expect(draft).toMatchObject({
      schemaVersion: 'invoice-extraction-v2',
      documentKind: 'pdf',
      sourcePages: [
        { pageNumber: 1, kind: 'pdf-page' },
        { pageNumber: 2, kind: 'pdf-page' },
      ],
    })
    expect(draft.lineItems[0]?.excludeFromPriceTracking).toBe(false)
  })

  test('deduplicates provider line item ids so repeated products remain independently editable', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'Proveedor SL',
          invoiceNo: 'F-102',
          date: '2026-05-08',
          subtotalAmount: '64.03',
          taxAmount: '13.45',
          totalAmount: '77.48',
          currency: 'EUR',
          notes: '',
        },
        lineItems: [
          {
            id: '802',
            name: 'ESTRELLA GALICIA 24x33 cl. RET',
            qty: '6',
            unit: 'ud',
            unitPrice: '25.61',
            lineTotal: '25.61',
            ingredient: '',
            matched: false,
          },
          {
            id: '802',
            name: 'ESTRELLA GALICIA 24x33 cl. RET',
            qty: '3',
            unit: 'ud',
            unitPrice: '38.42',
            lineTotal: '38.42',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.8,
          header: 0.9,
          lineItems: 0.75,
          totals: 0.85,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
      fileName: 'factura.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    })

    expect(new Set(draft.lineItems.map((item) => item.id)).size).toBe(2)
  })

  test('normalizes FP26020968 line items to tax-included unit and total prices', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'VINOS ISABEL MARIA CRUSAT SA',
          supplierTaxId: 'A58000985',
          supplierAddress: 'Carrer Miquel Servet 10-12, 08850 Gava (Barcelona)',
          customerName: 'BESCUIT BAR',
          customerTaxId: 'X7994517Q',
          customerAddress: 'ROGER DE FLOR 77-79, 08013 Barcelona',
          invoiceNo: 'FP26020968',
          date: '2026-04-21',
          subtotalAmount: '88.16',
          taxAmount: '18.51',
          totalAmount: '106.67',
          currency: 'EUR',
          notes: 'Forma de pago: CONT Contado/Metalico/Factura',
        },
        lineItems: [
          {
            id: '1',
            name: 'SERV. ENTREGA/RECOGIDA',
            qty: '1.00',
            unit: 'un',
            unitPrice: '3.49',
            lineTotal: '3.49',
            taxRate: '21%',
            ingredient: '',
            matched: false,
          },
          {
            id: '802',
            name: 'ESTRELLA GALICIA 24x33 cl. RET',
            qty: '4.00',
            unit: 'un',
            unitPrice: '31.75',
            lineTotal: '84.67',
            taxRate: '21%',
            notes: 'Descuento: 42,33',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.95,
          header: 0.98,
          lineItems: 0.95,
          totals: 0.95,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
      fileName: 'Factura venta FP26020968.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      documentKind: 'pdf',
    })

    expect(draft.header).toMatchObject({
      supplier: 'VINOS ISABEL MARIA CRUSAT SA',
      supplierTaxId: 'A58000985',
      supplierAddress: 'Carrer Miquel Servet 10-12, 08850 Gava (Barcelona)',
      customerName: 'BESCUIT BAR',
      customerTaxId: 'X7994517Q',
      customerAddress: 'ROGER DE FLOR 77-79, 08013 Barcelona',
      invoiceNo: 'FP26020968',
      date: '2026-04-21',
      totalAmount: '106.67',
      taxAmount: '18.51',
    })
    expect(draft.lineItems).toEqual([
      expect.objectContaining({
        id: '1',
        name: 'SERV. ENTREGA/RECOGIDA',
        qty: '1.00',
        unitPrice: '4.22',
        lineTotal: '4.22',
        taxRate: '21%',
        ingredient: '',
        matched: false,
      }),
      expect.objectContaining({
        id: '802',
        name: 'ESTRELLA GALICIA 24x33 cl. RET',
        qty: '4.00',
        unitPrice: '25.61',
        lineTotal: '102.45',
        taxRate: '21%',
        notes: 'Descuento: 42,33',
        ingredient: '',
        matched: false,
      }),
    ])
    expect(draft.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/行项目.*总额.*不一致/)]),
    )
  })

  test('keeps provider line totals that already include tax', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'Proveedor IVA Incluido SL',
          invoiceNo: 'F-IVA-1',
          date: '2026-05-18',
          subtotalAmount: '100.00',
          taxAmount: '21.00',
          totalAmount: '121.00',
          currency: 'EUR',
          notes: '',
        },
        lineItems: [
          {
            id: 'line-1',
            name: 'Producto con IVA',
            qty: '1',
            unit: 'un',
            unitPrice: '100.00',
            lineTotal: '121.00',
            taxRate: '21%',
            notes: '   ',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.95,
          header: 0.95,
          lineItems: 0.95,
          totals: 0.95,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
      fileName: 'iva-incluido.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      documentKind: 'pdf',
    })

    expect(draft.lineItems[0]).toMatchObject({
      unitPrice: '121.00',
      lineTotal: '121.00',
    })
    expect(draft.lineItems[0]?.notes).toBeUndefined()
    expect(draft.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/行项目.*总额.*不一致/)]),
    )
  })

  test('defaults to provider tax-included line totals when total is blank', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'Proveedor Sin Total SL',
          invoiceNo: 'F-NO-TOTAL-1',
          date: '2026-05-18',
          subtotalAmount: '100.00',
          taxAmount: '21.00',
          totalAmount: '',
          currency: 'EUR',
          notes: '',
        },
        lineItems: [
          {
            id: 'line-1',
            name: 'Producto ya con IVA',
            qty: '1',
            unit: 'un',
            unitPrice: '121.00',
            lineTotal: '121.00',
            taxRate: '21%',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.95,
          header: 0.95,
          lineItems: 0.95,
          totals: 0.5,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
      fileName: 'sin-total.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      documentKind: 'pdf',
    })

    expect(draft.lineItems[0]).toMatchObject({
      unitPrice: '121.00',
      lineTotal: '121.00',
      taxRate: '21%',
    })
  })

  test('interprets fraction-style tax rates as percentages for grossing net totals', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'Proveedor Fraccion SL',
          invoiceNo: 'F-FRAC-1',
          date: '2026-05-18',
          subtotalAmount: '110.00',
          taxAmount: '23.10',
          totalAmount: '133.10',
          currency: 'EUR',
          notes: '',
        },
        lineItems: [
          {
            id: 'line-1',
            name: 'Producto fraccion',
            qty: '1',
            unit: 'un',
            unitPrice: '100.00',
            lineTotal: '100.00',
            taxRate: '0.21',
            ingredient: '',
            matched: false,
          },
          {
            id: 'line-2',
            name: 'Producto sin cantidad',
            qty: '0',
            unit: 'un',
            unitPrice: '10.00',
            lineTotal: '10.00',
            taxRate: '0.21',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.95,
          header: 0.95,
          lineItems: 0.95,
          totals: 0.95,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
      fileName: 'iva-fraccion.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      documentKind: 'pdf',
    })

    expect(draft.lineItems).toEqual([
      expect.objectContaining({
        unitPrice: '121.00',
        lineTotal: '121.00',
      }),
      expect.objectContaining({
        unitPrice: '12.10',
        lineTotal: '12.10',
      }),
    ])
    expect(draft.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/行项目.*总额.*不一致/)]),
    )
  })

  test('uses normalized decimal-comma quantities when deriving unit price', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'Proveedor Decimal SL',
          invoiceNo: 'F-DEC-1',
          date: '2026-05-18',
          subtotalAmount: '15.00',
          taxAmount: '3.15',
          totalAmount: '18.15',
          currency: 'EUR',
          notes: '',
        },
        lineItems: [
          {
            id: 'line-1',
            name: 'Producto decimal',
            qty: '1,5',
            unit: 'kg',
            unitPrice: '10.00',
            lineTotal: '15.00',
            taxRate: '21%',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.95,
          header: 0.95,
          lineItems: 0.95,
          totals: 0.95,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
      fileName: 'decimal-comma.pdf',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      documentKind: 'pdf',
    })

    expect(draft.lineItems[0]).toMatchObject({
      qty: '1.5',
      unitPrice: '12.10',
      lineTotal: '18.15',
    })
    expect(draft.lineItems[0]?.excludeFromPriceTracking).toBe(false)
  })

  test('rehydrates v2 confidence and warnings for review jobs', () => {
    const job = buildInvoiceReviewJob({
      jobId: 'job-v2',
      fileName: 'factura.pdf',
      uploadedAt: '2026-04-18T08:00:00.000Z',
      stage: 'needs_review',
      structuredJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 2,
        documentKind: 'pdf',
        header: {
          supplier: 'Proveedor SL',
          invoiceNo: 'F-100',
          date: '2026-04-18',
          subtotalAmount: '80.00',
          taxAmount: '16.80',
          totalAmount: '96.80',
          currency: 'EUR',
          notes: 'Validar descuento',
        },
        lineItems: [
          {
            id: 'item-1',
            name: 'Tomate',
            qty: '10',
            unit: 'kg',
            unitPrice: '2.00',
            lineTotal: '20.00',
            ingredient: '',
            matched: false,
            confidence: 0.74,
            sourceText: 'Tomate 10 kg 20,00',
          },
        ],
        confidence: {
          overall: 0.81,
          header: 0.9,
          lineItems: 0.7,
          totals: 0.83,
        },
        warnings: ['Line item total requires review'],
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
    })

    expect(job.extraction).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      overallConfidence: 0.81,
      warnings: ['Line item total requires review'],
      schemaVersion: 'invoice-extraction-v2',
    })
    expect(job.lineItems[0]).toMatchObject({
      lineTotal: '20.00',
      confidence: 0.74,
      sourceText: 'Tomate 10 kg 20,00',
    })
  })

  test('extracts a review draft from markdown table content', () => {
    const draft = extractInvoiceReviewDraft({
      fileName: 'metro-factura-2026-04.pdf',
      provider: 'workers-ai',
      model: 'to-markdown',
      markdownText: `
METRO MADRID
Factura: FAC-2026-0418
Fecha: 2026-04-18
IVA: 12,50
Total: 87,40

| Producto | Cantidad | Unidad | Importe |
| --- | --- | --- | --- |
| Limon | 3 | kg | 11,40 |
| Coca Cola 330ml | 24 | ud | 18,00 |
      `,
    })

    expect(draft.header.supplier).toContain('METRO')
    expect(draft.header.invoiceNo).toBe('FAC-2026-0418')
    expect(draft.header.date).toBe('2026-04-18')
    expect(draft.header.taxAmount).toBe('12.50')
    expect(draft.header.totalAmount).toBe('87.40')
    expect(draft.lineItems).toHaveLength(2)
    expect(draft.lineItems[0]).toMatchObject({
      name: 'Limon',
      qty: '3',
      unit: 'kg',
      unitPrice: '11.40',
      matched: false,
    })
  })

  test('builds review jobs from stored extraction drafts', () => {
    const storedDraft = serializeExtractionDraft(
      extractInvoiceReviewDraft({
        fileName: 'makro-2026-04.pdf',
        provider: 'workers-ai',
        model: 'to-markdown',
        markdownText: 'Makro\nInvoice No: MK-001\nDate: 2026-04-10\nTotal: 16.80',
      }),
    )

    const job = buildInvoiceReviewJob({
      jobId: 'job-123',
      fileName: 'makro-2026-04.pdf',
      uploadedAt: '2026-04-18T08:00:00.000Z',
      stage: 'needs_review',
      errorMessage: null,
      structuredJson: storedDraft,
    })

    expect(job.status).toBe('needs_review')
    expect(job.stage).toBe('needs_review')
    expect(job.errorMessage).toBeNull()
    expect(job.header.invoiceNo).toBe('MK-001')
    expect(job.header.totalAmount).toBe('16.80')
  })

  test('falls back to pending drafts when stored extraction is invalid', () => {
    const draft = parseStoredExtractionDraft('{"invalid": true}', 'ticket.pdf')

    expect(draft.header.notes).toContain('等待 OCR')
    expect(draft.lineItems[0]?.name).toBe('待抽取明细')
  })

  test('treats ingredient-backed line items as matched when parsing stored drafts', () => {
    const draft = parseStoredExtractionDraft(
      JSON.stringify({
        lineItems: [
          {
            id: 'item-1',
            name: '柠檬',
            qty: '2',
            unit: 'kg',
            unitPrice: '3.20',
            ingredient: 'lemon',
            matched: false,
          },
        ],
      }),
      'ticket.pdf',
    )

    expect(draft.lineItems[0]).toMatchObject({
      ingredient: 'lemon',
      matched: true,
    })
    expect(draft.lineItems[0]?.excludeFromPriceTracking).toBe(false)
  })

  test('preserves explicit price tracking exclusions in stored drafts', () => {
    const draft = parseStoredExtractionDraft(
      JSON.stringify({
        lineItems: [
          {
            id: 'item-1',
            name: 'Promo beer',
            qty: '24',
            unit: 'can',
            unitPrice: '1.10',
            ingredient: '',
            matched: false,
            excludeFromPriceTracking: true,
          },
        ],
      }),
      'ticket.pdf',
    )

    expect(draft.lineItems[0]?.excludeFromPriceTracking).toBe(true)
  })

  test('maps intake stages to review status badges', () => {
    expect(mapIntakeStageToInvoiceStatus('queued')).toBe('uploaded')
    expect(mapIntakeStageToInvoiceStatus('extracting')).toBe('uploaded')
    expect(mapIntakeStageToInvoiceStatus('error')).toBe('error')
    expect(mapIntakeStageToInvoiceStatus('ready')).toBe('ready')
    expect(mapIntakeStageToInvoiceStatus('needs_review')).toBe('needs_review')
  })

  test('exposes helpers for queue idempotency and processing state', () => {
    expect(isTerminalIntakeStage('needs_review')).toBe(true)
    expect(isTerminalIntakeStage('ready')).toBe(true)
    expect(isTerminalIntakeStage('deleting')).toBe(true)
    expect(isTerminalIntakeStage('error')).toBe(false)
    expect(getExtractionResultId('job-123')).toBe('ext_job-123')

    const job = buildInvoiceReviewJob({
      jobId: 'job-456',
      fileName: 'pending.pdf',
      uploadedAt: '2026-04-18T08:00:00.000Z',
      stage: 'extracting',
      errorMessage: null,
    })

    expect(getInvoiceJobStage(job)).toBe('extracting')
    expect(isInvoiceJobProcessing(job)).toBe(true)
    expect(
      buildInvoiceReviewJob({
        jobId: 'job-789',
        fileName: 'deleting.pdf',
        uploadedAt: '2026-04-18T08:00:00.000Z',
        stage: 'deleting',
      }).stage,
    ).toBe('deleting')
    expect(getInvoiceStatusLabel('error')).toBe('处理失败')
  })
})

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return arrayBuffer
}
