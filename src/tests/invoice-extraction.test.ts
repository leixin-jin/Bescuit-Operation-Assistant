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

  test('selects Gemini provider from configured extraction env', () => {
    const provider = selectInvoiceExtractionProvider({
      INVOICE_EXTRACTION_PROVIDER: 'gemini',
      INVOICE_EXTRACTION_MODEL: 'gemini-3.5-flash',
      GEMINI_API_KEY: 'test-key',
    })

    expect(provider.id).toBe('gemini')
    expect(provider.model).toBe('gemini-3.5-flash')
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
