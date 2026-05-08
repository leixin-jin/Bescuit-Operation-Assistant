import { describe, expect, test, vi } from 'vitest'

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
      model: 'gemini-2.5-flash',
    }
    const fetchMock = vi.fn(async () =>
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
        model: 'gemini-2.5-flash',
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

  test('selects Gemini provider from configured extraction env', () => {
    const provider = selectInvoiceExtractionProvider({
      INVOICE_EXTRACTION_PROVIDER: 'gemini',
      INVOICE_EXTRACTION_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'test-key',
    })

    expect(provider.id).toBe('gemini')
    expect(provider.model).toBe('gemini-2.5-flash')
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
        model: 'gemini-2.5-flash',
      }),
    ).toThrow(/schema/i)
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
        model: 'gemini-2.5-flash',
      }),
    })

    expect(job.extraction).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
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
    expect(getInvoiceStatusLabel('error')).toBe('处理失败')
  })
})
