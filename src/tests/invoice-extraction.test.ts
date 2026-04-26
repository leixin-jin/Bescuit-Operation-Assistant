import { describe, expect, test } from 'vitest'

import {
  buildInvoiceReviewJob,
  extractInvoiceReviewDraft,
  getExtractionResultId,
  isTerminalIntakeStage,
  mapIntakeStageToInvoiceStatus,
  parseStoredExtractionDraft,
  serializeExtractionDraft,
} from '@/lib/server/extraction'
import { getInvoiceJobStage, getInvoiceStatusLabel, isInvoiceJobProcessing } from '@/lib/server/app-domain'

describe('invoice extraction helpers', () => {
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
