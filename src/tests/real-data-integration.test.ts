import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import type { AppBindings } from '@/lib/server/bindings'
import { getMadridTodayInputValue, type InvoiceReviewJob } from '@/lib/server/app-domain'
import {
  getCalendarAnalyticsSummaryFromDatabase,
  getMonthlyAnalyticsSummaryFromDatabase,
} from '@/lib/server/queries/analytics'
import { getDashboardSummaryFromDatabase } from '@/lib/server/queries/dashboard'
import {
  getInvoiceDocumentPreviewFromDatabase,
  getInvoiceDocumentPreviewResponse,
} from '@/lib/server/queries/document-preview'
import { listIngredientOptionsFromDatabase } from '@/lib/server/queries/ingredients'
import { getSalesRecordFromDatabase } from '@/lib/server/queries/sales'
import {
  saveSalesDraftToDatabase,
  submitSalesEntryToDatabase,
} from '@/lib/server/mutations/sales'
import {
  confirmInvoiceReviewJobInDatabase,
  deleteInvoiceIntakeJobFromDatabase,
} from '@/lib/server/mutations/invoices.rpc'
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

describe('real data integration boundaries', () => {
  test('production business data modules do not import fallback-store directly', () => {
    const files = [
      'src/lib/server/queries/sales.ts',
      'src/lib/server/mutations/sales.ts',
      'src/lib/server/queries/dashboard.ts',
      'src/lib/server/queries/analytics.ts',
      'src/lib/server/queries/invoices.rpc.ts',
      'src/lib/server/mutations/invoices.rpc.ts',
    ]

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).not.toContain('fallback-store')
    }
  })

  test('demo data is rejected by default in production runtime', () => {
    expect(() =>
      assertDemoDataEnabled(
        { MODE: 'production', ENABLE_DEMO_DATA: 'false' },
        'sales',
      ),
    ).toThrow(/demo|fallback/i)

    expect(() => assertDemoDataEnabled({ MODE: 'development' }, 'sales')).not.toThrow()
  })
})

describe('sales D1 integration', () => {
  test('draft and submitted sales upsert sales_daily by date', async () => {
    const { env, tables } = createFakeD1Env()

    await saveSalesDraftToDatabase(env, {
      date: '2026-04-27',
      amounts: {
        bbva: '100.00',
        caixa: '80.25',
        efectivo: '19.75',
      },
      notes: 'draft note',
    })

    expect(tables.sales_daily).toHaveLength(1)
    expect(tables.sales_daily[0]).toMatchObject({
      date: '2026-04-27',
      total_amount: 200,
      status: 'draft',
      note: 'draft note',
    })

    await submitSalesEntryToDatabase(env, {
      date: '2026-04-27',
      amounts: {
        bbva: '120',
        caixa: '30',
        efectivo: '50',
      },
      notes: 'submitted note',
    })

    const storedRecord = await getSalesRecordFromDatabase(env, '2026-04-27')

    expect(tables.sales_daily).toHaveLength(1)
    expect(storedRecord).toMatchObject({
      date: '2026-04-27',
      totalAmount: 200,
      bbvaAmount: 120,
      caixaAmount: 30,
      cashAmount: 50,
      status: 'submitted',
      note: 'submitted note',
    })
  })
})

describe('dashboard and analytics D1 integration', () => {
  test('empty months stay empty instead of using generated seed data', async () => {
    const { env } = createFakeD1Env()

    const summary = await getCalendarAnalyticsSummaryFromDatabase(env, '2026-04')

    expect(summary.totalIncome).toBe(0)
    expect(summary.totalExpense).toBe(0)
    expect(summary.days).toEqual({})
  })

  test('monthly and calendar summaries aggregate submitted sales and ledger expenses', async () => {
    const { env, tables } = createFakeD1Env({
      sales_daily: [
        createSalesRow({
          date: '2026-04-05',
          total_amount: 200,
          bbva_amount: 100,
          caixa_amount: 60,
          cash_amount: 40,
          status: 'submitted',
        }),
        createSalesRow({
          date: '2026-04-06',
          total_amount: 999,
          status: 'draft',
        }),
      ],
      ledger_entries: [
        createLedgerRow({
          entry_date: '2026-04-05',
          category: 'beer',
          amount: 60,
        }),
        createLedgerRow({
          entry_date: '2026-04-12',
          category: 'food',
          amount: 40,
        }),
      ],
    })

    const calendarSummary = await getCalendarAnalyticsSummaryFromDatabase(
      env,
      '2026-04',
    )
    const monthlySummary = await getMonthlyAnalyticsSummaryFromDatabase(env, '2026-04')

    expect(calendarSummary.days).toMatchObject({
      '5': { income: 200, expense: 60 },
      '12': { income: 0, expense: 40 },
    })
    expect(calendarSummary.totalIncome).toBe(200)
    expect(calendarSummary.totalExpense).toBe(100)
    expect(monthlySummary.incomeBreakdown).toEqual([
      { name: 'BBVA', value: 100, percentage: 50 },
      { name: 'CAIXA', value: 60, percentage: 30 },
      { name: 'EFECTIVO', value: 40, percentage: 20 },
    ])
    expect(monthlySummary.expenseBreakdown).toEqual([
      { name: 'beer', value: 60, percentage: 60 },
      { name: 'food', value: 40, percentage: 40 },
    ])
    expect(tables.sales_daily).toHaveLength(2)
  })

  test('dashboard summary is derived from D1 records only', async () => {
    const today = getMadridTodayInputValue()
    const currentMonth = today.slice(0, 7)
    const { env } = createFakeD1Env({
      sales_daily: [
        createSalesRow({
          date: today,
          status: 'submitted',
          total_amount: 42,
          updated_at: `${today}T20:00:00.000Z`,
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-pending',
          stage: 'needs_review',
          updated_at: `${today}T19:00:00.000Z`,
        }),
      ],
      invoices: [
        createInvoiceRow({
          id: 'inv-ready',
          invoice_date: `${currentMonth}-03`,
          total_amount: 88,
        }),
      ],
      ledger_entries: [
        createLedgerRow({
          entry_date: `${currentMonth}-03`,
          amount: 88,
        }),
      ],
    })

    const summary = await getDashboardSummaryFromDatabase(env)

    expect(summary.salesRecordedToday).toBe(true)
    expect(summary.pendingInvoiceCount).toBe(1)
    expect(summary.monthlyInvoiceCount).toBe(1)
    expect(summary.monthlyExpenseTotal).toBe(88)
  })
})

describe('invoice review D1 integration', () => {
  test('document preview reads the source document from R2 by job id', async () => {
    const { env } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-1',
          r2_key: 'raw-documents/2026/04/src-1-invoice.png',
          original_filename: 'invoice.png',
          mime_type: 'image/png',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-1',
          source_document_id: 'src-1',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-1-invoice.png': {
        body: 'preview-bytes',
        contentType: 'image/png',
      },
    })

    await expect(getInvoiceDocumentPreviewFromDatabase(env, 'job-1')).resolves.toEqual({
      fileName: 'invoice.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,cHJldmlldy1ieXRlcw==',
      kind: 'image',
    })
  })

  test('pdf document preview uses a same-origin response stream instead of a data URL', async () => {
    const { env } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-pdf',
          r2_key: 'raw-documents/2026/04/src-pdf-invoice.pdf',
          original_filename: 'invoice.pdf',
          mime_type: 'application/pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-pdf',
          source_document_id: 'src-pdf',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-pdf-invoice.pdf': {
        body: '%PDF-preview-bytes',
        contentType: 'application/pdf',
      },
    })

    await expect(getInvoiceDocumentPreviewFromDatabase(env, 'job-pdf')).resolves.toEqual({
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      previewUrl: '/api/invoice-document-preview/job-pdf',
      kind: 'pdf',
    })

    const response = await getInvoiceDocumentPreviewResponse(env, 'job-pdf')

    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('inline')
    await expect(response.text()).resolves.toBe('%PDF-preview-bytes')
  })

  test('ingredient options come from the ingredients table', async () => {
    const { env } = createFakeD1Env({
      ingredients: [
        createIngredientRow({ id: 'lime', name: 'Lime' }),
        createIngredientRow({ id: 'mint', name: 'Mint' }),
      ],
    })

    await expect(listIngredientOptionsFromDatabase(env)).resolves.toEqual([
      { value: 'lime', label: 'Lime' },
      { value: 'mint', label: 'Mint' },
    ])
  })

  test('confirming a ready review job writes invoice, items, and ledger idempotently', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-1',
          original_filename: 'invoice.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-1',
          source_document_id: 'src-1',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        {
          id: 'ext-job-1',
          intake_job_id: 'job-1',
          markdown_text: '',
          structured_json: null,
          raw_response: null,
          schema_version: 'invoice-extraction-v1',
          created_at: '2026-04-27T10:00:00.000Z',
        },
      ],
      ingredients: [createIngredientRow({ id: 'coke-330', name: 'Coke 330ml' })],
    })
    const job = createReadyReviewJob()

    const firstResult = await confirmInvoiceReviewJobInDatabase(env, job)
    const secondResult = await confirmInvoiceReviewJobInDatabase(env, job)

    expect(firstResult.ok).toBe(true)
    expect(secondResult.ok).toBe(true)
    expect(tables.intake_jobs[0]?.stage).toBe('ready')
    expect(tables.invoices).toHaveLength(1)
    expect(tables.invoices[0]).toMatchObject({
      intake_job_id: 'job-1',
      source_document_id: 'src-1',
      invoice_date: '2026-04-20',
      supplier_name: 'Makro Madrid',
      document_number: 'MK-001',
      tax_amount: 21,
      total_amount: 121,
      review_status: 'ready',
    })
    expect(tables.invoice_items).toHaveLength(1)
    expect(tables.invoice_items[0]).toMatchObject({
      invoice_id: tables.invoices[0]?.id,
      raw_product_name: 'Coke 330ml',
      ingredient_id: 'coke-330',
      mapping_status: 'matched',
    })
    expect(tables.ledger_entries).toHaveLength(1)
    expect(tables.ledger_entries[0]).toMatchObject({
      entry_date: '2026-04-20',
      entry_type: 'expense',
      category: 'purchase',
      amount: 121,
      vendor: 'Makro Madrid',
      source_kind: 'invoice',
      source_id: tables.invoices[0]?.id,
    })
  })

  test('confirming a deleting review job rejects without writing accounting rows', async () => {
    const existingStructuredJson = JSON.stringify({
      header: {
        supplier: 'Original Supplier',
        invoiceNo: 'ORIGINAL-1',
        date: '2026-04-19',
        totalAmount: '10.00',
        taxAmount: '1.00',
        notes: 'Original notes',
      },
      lineItems: [],
      markdownText: 'Original markdown',
    })
    const existingMarkdownText = 'Original markdown'
    const { env, tables } = createFakeD1Env({
      source_documents: [createSourceDocumentRow({ id: 'src-1' })],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-1',
          source_document_id: 'src-1',
          stage: 'deleting',
        }),
      ],
      extraction_results: [
        {
          id: 'ext-job-1',
          intake_job_id: 'job-1',
          markdown_text: existingMarkdownText,
          structured_json: existingStructuredJson,
          raw_response: null,
          schema_version: 'invoice-extraction-v1',
          created_at: '2026-04-27T10:00:00.000Z',
        },
      ],
      ingredients: [createIngredientRow({ id: 'coke-330', name: 'Coke 330ml' })],
    })

    await expect(
      confirmInvoiceReviewJobInDatabase(env, createReadyReviewJob()),
    ).rejects.toThrow(/删除|deleting/i)

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.extraction_results[0]?.structured_json).toBe(existingStructuredJson)
    expect(tables.extraction_results[0]?.markdown_text).toBe(existingMarkdownText)
    expect(tables.invoices).toHaveLength(0)
    expect(tables.invoice_items).toHaveLength(0)
    expect(tables.ledger_entries).toHaveLength(0)
  })

  test('confirming a job that becomes deleting before draft write preserves extraction data', async () => {
    const existingStructuredJson = JSON.stringify({
      header: {
        supplier: 'Original Supplier',
        invoiceNo: 'ORIGINAL-1',
        date: '2026-04-19',
        totalAmount: '10.00',
        taxAmount: '1.00',
        notes: 'Original notes',
      },
      lineItems: [],
      markdownText: 'Original markdown',
    })
    const existingMarkdownText = 'Original markdown'
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [createSourceDocumentRow({ id: 'src-1' })],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-1',
            source_document_id: 'src-1',
            stage: 'needs_review',
          }),
        ],
        extraction_results: [
          {
            id: 'ext-job-1',
            intake_job_id: 'job-1',
            markdown_text: existingMarkdownText,
            structured_json: existingStructuredJson,
            raw_response: null,
            schema_version: 'invoice-extraction-v1',
            created_at: '2026-04-27T10:00:00.000Z',
          },
        ],
        ingredients: [createIngredientRow({ id: 'coke-330', name: 'Coke 330ml' })],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('invoice:update-extraction')) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )

    await expect(
      confirmInvoiceReviewJobInDatabase(env, createReadyReviewJob()),
    ).rejects.toThrow(/删除|deleting/i)

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.extraction_results[0]?.structured_json).toBe(existingStructuredJson)
    expect(tables.extraction_results[0]?.markdown_text).toBe(existingMarkdownText)
    expect(tables.invoices).toHaveLength(0)
    expect(tables.invoice_items).toHaveLength(0)
    expect(tables.ledger_entries).toHaveLength(0)
  })

  test('confirming a job that becomes deleting before accounting writes no accounting rows', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [createSourceDocumentRow({ id: 'src-1' })],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-1',
            source_document_id: 'src-1',
            stage: 'needs_review',
          }),
        ],
        extraction_results: [
          {
            id: 'ext-job-1',
            intake_job_id: 'job-1',
            markdown_text: '',
            structured_json: null,
            raw_response: null,
            schema_version: 'invoice-extraction-v1',
            created_at: '2026-04-27T10:00:00.000Z',
          },
        ],
        ingredients: [createIngredientRow({ id: 'coke-330', name: 'Coke 330ml' })],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('invoice:upsert-invoice')) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )

    await expect(
      confirmInvoiceReviewJobInDatabase(env, createReadyReviewJob()),
    ).rejects.toThrow(/删除|deleting/i)

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.invoices).toHaveLength(0)
    expect(tables.invoice_items).toHaveLength(0)
    expect(tables.ledger_entries).toHaveLength(0)
  })

  test('deleting an unfinished intake job deletes extraction rows, D1 records, and the R2 object', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-delete',
          r2_key: 'raw-documents/2026/04/src-delete-invoice.pdf',
          original_filename: 'delete-me.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-delete',
          source_document_id: 'src-delete',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        {
          id: 'ext-delete',
          intake_job_id: 'job-delete',
          markdown_text: 'markdown',
          structured_json: null,
          raw_response: null,
          schema_version: 'invoice-extraction-v1',
          created_at: '2026-04-27T10:00:00.000Z',
        },
      ],
    })
    const r2 = createFakeR2Bucket({
      'raw-documents/2026/04/src-delete-invoice.pdf': {
        body: '%PDF-delete-me',
        contentType: 'application/pdf',
      },
    })
    env.RAW_DOCUMENTS = r2

    await expect(deleteInvoiceIntakeJobFromDatabase(env, 'job-delete')).resolves.toEqual({
      ok: true,
      deleted: true,
    })

    expect(tables.extraction_results).toHaveLength(0)
    expect(tables.intake_jobs).toHaveLength(0)
    expect(tables.source_documents).toHaveLength(0)
    await expect(
      env.RAW_DOCUMENTS.get('raw-documents/2026/04/src-delete-invoice.pdf'),
    ).resolves.toBeNull()
  })

  test('deleting a ready intake job is rejected before D1 or R2 is mutated', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [createSourceDocumentRow({ id: 'src-ready' })],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-ready',
          source_document_id: 'src-ready',
          stage: 'ready',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-1-invoice.pdf': {
        body: '%PDF-ready',
        contentType: 'application/pdf',
      },
    })

    await expect(deleteInvoiceIntakeJobFromDatabase(env, 'job-ready')).rejects.toThrow(
      /已完成|cannot delete/i,
    )

    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.source_documents).toHaveLength(1)
    await expect(
      env.RAW_DOCUMENTS.get('raw-documents/2026/04/src-1-invoice.pdf'),
    ).resolves.not.toBeNull()
  })

  test('deleting an intake job rejects if it becomes ready before deletion is claimed', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-race',
            r2_key: 'raw-documents/2026/04/src-race-invoice.pdf',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-race',
            source_document_id: 'src-race',
            stage: 'needs_review',
          }),
        ],
        extraction_results: [
          {
            id: 'ext-race',
            intake_job_id: 'job-race',
            markdown_text: 'markdown',
            structured_json: null,
            raw_response: null,
            schema_version: 'invoice-extraction-v1',
            created_at: '2026-04-27T10:00:00.000Z',
          },
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('invoice:delete-intake-claim')) {
            currentTables.intake_jobs[0].stage = 'ready'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-race-invoice.pdf': {
        body: '%PDF-race',
        contentType: 'application/pdf',
      },
    })

    await expect(deleteInvoiceIntakeJobFromDatabase(env, 'job-race')).rejects.toThrow(
      /已完成|cannot delete/i,
    )

    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0].stage).toBe('ready')
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.extraction_results).toHaveLength(1)
    await expect(
      env.RAW_DOCUMENTS.get('raw-documents/2026/04/src-race-invoice.pdf'),
    ).resolves.not.toBeNull()
  })

  test('delete cleanup rejects and preserves source document if deleting claim is lost after R2 deletion', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-lost-claim',
            r2_key: 'raw-documents/2026/04/src-lost-claim-invoice.pdf',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-lost-claim',
            source_document_id: 'src-lost-claim',
            stage: 'needs_review',
          }),
        ],
        extraction_results: [
          {
            id: 'ext-lost-claim',
            intake_job_id: 'job-lost-claim',
            markdown_text: 'markdown',
            structured_json: null,
            raw_response: null,
            schema_version: 'invoice-extraction-v1',
            created_at: '2026-04-27T10:00:00.000Z',
          },
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('invoice:delete-intake-job')) {
            currentTables.intake_jobs[0].stage = 'needs_review'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-lost-claim-invoice.pdf': {
        body: '%PDF-lost-claim',
        contentType: 'application/pdf',
      },
    })

    await expect(
      deleteInvoiceIntakeJobFromDatabase(env, 'job-lost-claim'),
    ).rejects.toThrow(/删除状态|deleting|claim/i)

    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0].stage).toBe('needs_review')
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.extraction_results).toHaveLength(0)
    await expect(
      env.RAW_DOCUMENTS.get('raw-documents/2026/04/src-lost-claim-invoice.pdf'),
    ).resolves.toBeNull()
  })

  test('deleting restores the previous stage if R2 deletion fails after claim', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-r2-fail',
          r2_key: 'raw-documents/2026/04/src-r2-fail-invoice.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-r2-fail',
          source_document_id: 'src-r2-fail',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        {
          id: 'ext-r2-fail',
          intake_job_id: 'job-r2-fail',
          markdown_text: 'markdown',
          structured_json: null,
          raw_response: null,
          schema_version: 'invoice-extraction-v1',
          created_at: '2026-04-27T10:00:00.000Z',
        },
      ],
    })
    env.RAW_DOCUMENTS = {
      delete: async () => {
        throw new Error('r2 unavailable')
      },
    } as unknown as R2Bucket

    await expect(deleteInvoiceIntakeJobFromDatabase(env, 'job-r2-fail')).rejects.toThrow(
      'r2 unavailable',
    )

    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0].stage).toBe('needs_review')
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.extraction_results).toHaveLength(1)
  })

  test('queue processing treats a deleted intake job as an idempotent no-op', async () => {
    const { env } = createFakeD1Env()
    env.RAW_DOCUMENTS = createFakeR2Bucket({})

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-already-deleted',
        sourceDocumentId: 'src-already-deleted',
        r2Key: 'raw-documents/2026/04/deleted.pdf',
        fileName: 'deleted.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-already-deleted',
      stage: 'deleted',
    })
  })

  test('queue processing treats a deleting intake job as an idempotent no-op', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [createSourceDocumentRow({ id: 'src-deleting' })],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-deleting',
          source_document_id: 'src-deleting',
          stage: 'deleting',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({})

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-deleting',
        sourceDocumentId: 'src-deleting',
        r2Key: 'raw-documents/2026/04/deleting.pdf',
        fileName: 'deleting.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-deleting',
      stage: 'deleting',
    })

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
  })

  test('queue success race does not write extraction data after job becomes deleting', async () => {
    let stageReadCount = 0
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-queue-race',
            r2_key: 'raw-documents/2026/04/queue-race.pdf',
            status: 'uploaded',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-queue-race',
            source_document_id: 'src-queue-race',
            stage: 'queued',
          }),
        ],
      },
      {
        beforeSelect: ({ sql, tables: currentTables }) => {
          if (sql.includes('select "stage"') && sql.includes('from "intake_jobs"')) {
            stageReadCount += 1

            if (stageReadCount === 2) {
              currentTables.intake_jobs[0].stage = 'deleting'
            }
          }
        },
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('insert into "extraction_results"')) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/queue-race.pdf': {
        body: '%PDF-queue-race',
        contentType: 'application/pdf',
      },
    })

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-queue-race',
        sourceDocumentId: 'src-queue-race',
        r2Key: 'raw-documents/2026/04/queue-race.pdf',
        fileName: 'queue-race.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-queue-race',
      stage: 'deleting',
    })

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.extraction_results).toHaveLength(0)
    expect(tables.source_documents[0]?.status).toBe('uploaded')
  })

  test('queue extraction insert is skipped if job becomes deleting after the success recheck', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-queue-insert-race',
            r2_key: 'raw-documents/2026/04/queue-insert-race.pdf',
            status: 'uploaded',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-queue-insert-race',
            source_document_id: 'src-queue-insert-race',
            stage: 'queued',
          }),
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (
            sql.includes('invoice:queue-upsert-extraction') ||
            sql.includes('insert into "extraction_results"')
          ) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/queue-insert-race.pdf': {
        body: '%PDF-queue-insert-race',
        contentType: 'application/pdf',
      },
    })

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-queue-insert-race',
        sourceDocumentId: 'src-queue-insert-race',
        r2Key: 'raw-documents/2026/04/queue-insert-race.pdf',
        fileName: 'queue-insert-race.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-queue-insert-race',
      stage: 'deleting',
    })

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.extraction_results).toHaveLength(0)
    expect(tables.source_documents[0]?.status).toBe('uploaded')
  })

  test('queue success source update is skipped if delete claim wins after stage update', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-queue-source-race',
            r2_key: 'raw-documents/2026/04/queue-source-race.pdf',
            status: 'uploaded',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-queue-source-race',
            source_document_id: 'src-queue-source-race',
            stage: 'queued',
          }),
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('invoice:queue-source-processed')) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/queue-source-race.pdf': {
        body: '%PDF-queue-source-race',
        contentType: 'application/pdf',
      },
    })

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-queue-source-race',
        sourceDocumentId: 'src-queue-source-race',
        r2Key: 'raw-documents/2026/04/queue-source-race.pdf',
        fileName: 'queue-source-race.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-queue-source-race',
      stage: 'deleting',
    })

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.source_documents[0]?.status).toBe('uploaded')
  })

  test('queue failure race returns deleting instead of retrying when delete claim wins', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-queue-failure-race',
            r2_key: 'raw-documents/2026/04/queue-failure-race.pdf',
            status: 'uploaded',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-queue-failure-race',
            source_document_id: 'src-queue-failure-race',
            stage: 'queued',
          }),
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (
            sql.includes('update "intake_jobs"') &&
            currentTables.intake_jobs[0]?.stage === 'extracting'
          ) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({})

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-queue-failure-race',
        sourceDocumentId: 'src-queue-failure-race',
        r2Key: 'raw-documents/2026/04/queue-failure-race.pdf',
        fileName: 'queue-failure-race.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-queue-failure-race',
      stage: 'deleting',
    })

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.source_documents[0]?.status).toBe('uploaded')
  })

  test('queue failure source update is skipped if delete claim wins after error stage update', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-queue-error-source-race',
            r2_key: 'raw-documents/2026/04/queue-error-source-race.pdf',
            status: 'uploaded',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-queue-error-source-race',
            source_document_id: 'src-queue-error-source-race',
            stage: 'queued',
          }),
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('invoice:queue-source-error')) {
            currentTables.intake_jobs[0].stage = 'deleting'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({})

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-queue-error-source-race',
        sourceDocumentId: 'src-queue-error-source-race',
        r2Key: 'raw-documents/2026/04/queue-error-source-race.pdf',
        fileName: 'queue-error-source-race.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-queue-error-source-race',
      stage: 'deleting',
    })

    expect(tables.intake_jobs[0]?.stage).toBe('deleting')
    expect(tables.source_documents[0]?.status).toBe('uploaded')
  })
})

interface FakeTables {
  sales_daily: SalesDailyRow[]
  source_documents: SourceDocumentRow[]
  intake_jobs: IntakeJobRow[]
  extraction_results: ExtractionResultRow[]
  ingredients: IngredientRow[]
  invoices: InvoiceRow[]
  invoice_items: InvoiceItemRow[]
  ledger_entries: LedgerEntryRow[]
}

type FakeTableInput = Partial<{ [K in keyof FakeTables]: FakeTables[K] }>

interface FakeD1Options {
  beforeSelect?: (context: { sql: string; tables: FakeTables }) => void
  beforeMutation?: (context: { sql: string; tables: FakeTables }) => void
}

interface SalesDailyRow {
  id: string
  date: string
  total_amount: number
  bbva_amount: number
  caixa_amount: number
  cash_amount: number
  status: string
  note: string
  source_document_id: string | null
  updated_at: string
}

interface SourceDocumentRow {
  id: string
  source_type: string
  document_type_guess: string
  r2_key: string | null
  original_filename: string
  mime_type: string | null
  uploaded_by: string | null
  status: string
  uploaded_at: string
}

interface IntakeJobRow {
  id: string
  source_document_id: string
  extractor_provider: string | null
  extractor_model: string | null
  stage: string
  confidence_score: number | null
  error_message: string | null
  created_at: string
  updated_at: string
}

interface ExtractionResultRow {
  id: string
  intake_job_id: string
  markdown_text: string | null
  structured_json: string | null
  raw_response: string | null
  schema_version: string | null
  created_at: string
}

interface IngredientRow {
  id: string
  name: string
  category: string | null
  base_unit: string
  is_focus: string
  price_lower_bound: number | null
  price_upper_bound: number | null
  notes: string | null
  created_at: string
}

interface InvoiceRow {
  id: string
  intake_job_id: string | null
  invoice_date: string
  supplier_name: string
  document_number: string
  subtotal_amount: number | null
  tax_amount: number
  total_amount: number
  payment_method: string | null
  currency: string
  source_document_id: string | null
  review_status: string
  created_at: string
  updated_at: string
}

interface InvoiceItemRow {
  id: string
  invoice_id: string
  raw_product_name: string
  raw_quantity: number | null
  raw_unit: string | null
  raw_unit_price: number | null
  raw_line_total: number | null
  ingredient_id: string | null
  normalized_quantity: number | null
  normalized_unit: string | null
  normalized_unit_price: number | null
  mapping_status: string
}

interface LedgerEntryRow {
  id: string
  entry_date: string
  entry_type: string
  category: string
  amount: number
  account: string | null
  vendor: string | null
  source_kind: string
  source_id: string
  created_at: string
}

function createFakeD1Env(
  initialTables: FakeTableInput = {},
  options: FakeD1Options = {},
) {
  const tables: FakeTables = {
    sales_daily: initialTables.sales_daily ?? [],
    source_documents: initialTables.source_documents ?? [],
    intake_jobs: initialTables.intake_jobs ?? [],
    extraction_results: initialTables.extraction_results ?? [],
    ingredients: initialTables.ingredients ?? [],
    invoices: initialTables.invoices ?? [],
    invoice_items: initialTables.invoice_items ?? [],
    ledger_entries: initialTables.ledger_entries ?? [],
  }

  return {
    env: {
      DB: new FakeD1Database(tables, options) as unknown as D1Database,
      MODE: 'test',
    } satisfies Partial<AppBindings> as AppBindings,
    tables,
  }
}

class FakeD1Database {
  constructor(
    private readonly tables: FakeTables,
    private readonly options: FakeD1Options,
  ) {}

  prepare(sql: string) {
    return new FakeD1PreparedStatement(this.tables, this.options, sql)
  }

  async batch(statements: FakeD1PreparedStatement[]) {
    const results = []

    for (const statement of statements) {
      results.push(await statement.run())
    }

    return results
  }
}

class FakeD1PreparedStatement {
  private params: unknown[] = []

  constructor(
    private readonly tables: FakeTables,
    private readonly options: FakeD1Options,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]) {
    this.params = params
    return this
  }

  async all<T>() {
    return {
      success: true,
      meta: {},
      results: this.selectRows() as T[],
    }
  }

  async first<T>() {
    return (this.selectRows()[0] ?? null) as T | null
  }

  async run() {
    this.options.beforeMutation?.({ sql: this.sql, tables: this.tables })
    const changes = this.mutateRows()
    return {
      success: true,
      meta: { changes },
    }
  }

  async raw() {
    return this.selectRows().map((row) => Object.values(row))
  }

  private selectRows() {
    const sql = this.sql
    this.options.beforeSelect?.({ sql, tables: this.tables })

    if (sql.includes('sales:get-by-date')) {
      const [date] = this.params
      return this.tables.sales_daily
        .filter((row) => row.date === date)
        .slice(0, 1)
        .map(toSalesResult)
    }

    if (sql.includes('sales:list-recent')) {
      const [limit] = this.params
      return this.tables.sales_daily
        .slice()
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, Number(limit))
        .map(toSalesResult)
    }

    if (sql.includes('analytics:sales-month')) {
      const [startDate, endDate] = this.params
      return this.tables.sales_daily
        .filter(
          (row) =>
            row.status === 'submitted' &&
            row.date >= String(startDate) &&
            row.date < String(endDate),
        )
        .map(toSalesResult)
    }

    if (sql.includes('analytics:expenses-month')) {
      const [startDate, endDate] = this.params
      return this.tables.ledger_entries
        .filter(
          (row) =>
            row.entry_type === 'expense' &&
            row.entry_date >= String(startDate) &&
            row.entry_date < String(endDate),
        )
        .map((row) => ({
          entryDate: row.entry_date,
          category: row.category,
          amount: row.amount,
        }))
    }

    if (sql.includes('dashboard:pending-invoices')) {
      return [
        {
          count: this.tables.intake_jobs.filter((row) => row.stage !== 'ready')
            .length,
        },
      ]
    }

    if (sql.includes('dashboard:today-sales')) {
      const [date] = this.params
      return [
        {
          count: this.tables.sales_daily.filter(
            (row) => row.date === date && row.status === 'submitted',
          ).length,
        },
      ]
    }

    if (sql.includes('dashboard:monthly-invoices')) {
      const [startDate, endDate] = this.params
      return [
        {
          count: this.tables.invoices.filter(
            (row) =>
              row.invoice_date >= String(startDate) &&
              row.invoice_date < String(endDate),
          ).length,
        },
      ]
    }

    if (sql.includes('dashboard:last-activity')) {
      const candidates = [
        ...this.tables.sales_daily.map((row) => row.updated_at),
        ...this.tables.source_documents.map((row) => row.uploaded_at),
        ...this.tables.intake_jobs.map((row) => row.updated_at),
        ...this.tables.invoices.map((row) => row.updated_at),
      ].filter(Boolean)

      return [{ lastActivityAt: candidates.slice().sort().reverse()[0] ?? null }]
    }

    if (sql.includes('ingredients:list-options')) {
      return this.tables.ingredients
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((row) => ({
          value: row.id,
          label: row.name,
        }))
    }

    if (sql.includes('invoice:get-intake-source')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      return job ? [{ sourceDocumentId: job.source_document_id }] : []
    }

    if (sql.includes('invoice:review-draft-stage')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      return job ? [{ stage: job.stage }] : []
    }

    if (sql.includes('select "stage"') && sql.includes('from "intake_jobs"')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      return job ? [{ stage: job.stage }] : []
    }

    if (sql.includes('invoice:delete-intake-load')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      const sourceDocument = this.tables.source_documents.find(
        (row) => row.id === job?.source_document_id,
      )

      return job && sourceDocument
        ? [
            {
              jobId: job.id,
              stage: job.stage,
              sourceDocumentId: sourceDocument.id,
              r2Key: sourceDocument.r2_key,
            },
          ]
        : []
    }

    if (sql.includes('invoice:latest-extraction')) {
      const [jobId] = this.params
      return this.tables.extraction_results
        .filter((row) => row.intake_job_id === jobId)
        .slice()
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, 1)
        .map((row) => ({
          id: row.id,
          structuredJson: row.structured_json,
          markdownText: row.markdown_text,
        }))
    }

    if (sql.includes('document-preview:get-source')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      const sourceDocument = this.tables.source_documents.find(
        (row) => row.id === job?.source_document_id,
      )

      return sourceDocument
        ? [
            {
              fileName: sourceDocument.original_filename,
              mimeType: sourceDocument.mime_type,
              r2Key: sourceDocument.r2_key,
            },
          ]
        : []
    }

    throw new Error(`Unhandled fake D1 select: ${sql}`)
  }

  private mutateRows() {
    const sql = this.sql

    if (sql.includes('sales:upsert')) {
      const [
        id,
        date,
        totalAmount,
        bbvaAmount,
        caixaAmount,
        cashAmount,
        status,
        note,
        updatedAt,
      ] = this.params
      const existingRow = this.tables.sales_daily.find((row) => row.date === date)
      const nextRow: SalesDailyRow = {
        id: String(id),
        date: String(date),
        total_amount: Number(totalAmount),
        bbva_amount: Number(bbvaAmount),
        caixa_amount: Number(caixaAmount),
        cash_amount: Number(cashAmount),
        status: String(status),
        note: String(note),
        source_document_id: null,
        updated_at: String(updatedAt),
      }

      if (existingRow) {
        Object.assign(existingRow, nextRow, { id: existingRow.id })
      } else {
        this.tables.sales_daily.push(nextRow)
      }
      return 1
    }

    if (sql.includes('invoice:update-extraction')) {
      const [
        structuredJson,
        markdownText,
        rawResponse,
        schemaVersion,
        extractionId,
        jobId,
      ] = this.params
      const job = this.tables.intake_jobs.find((candidate) => candidate.id === jobId)
      const row = this.tables.extraction_results.find(
        (candidate) => candidate.id === extractionId,
      )

      if (row && (!sql.includes('stage !=') || job?.stage !== 'deleting')) {
        row.structured_json = String(structuredJson)
        row.markdown_text = String(markdownText)
        row.raw_response = String(rawResponse)
        row.schema_version = String(schemaVersion)
        return 1
      }
      return 0
    }

    if (sql.includes('invoice:insert-extraction')) {
      const [
        id,
        intakeJobId,
        markdownText,
        structuredJson,
        rawResponse,
        schemaVersion,
        createdAt,
        jobId,
      ] = this.params
      const job = this.tables.intake_jobs.find((candidate) => candidate.id === jobId)

      if (sql.includes('stage !=') && job?.stage === 'deleting') {
        return 0
      }

      this.tables.extraction_results.push({
        id: String(id),
        intake_job_id: String(intakeJobId),
        markdown_text: String(markdownText),
        structured_json: String(structuredJson),
        raw_response: String(rawResponse),
        schema_version: String(schemaVersion),
        created_at: String(createdAt),
      })
      return 1
    }

    if (sql.includes('invoice:queue-upsert-extraction')) {
      const [
        id,
        intakeJobId,
        markdownText,
        structuredJson,
        rawResponse,
        schemaVersion,
        createdAt,
        jobId,
      ] = this.params
      const job = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === 'extracting',
      )

      if (!job) {
        return 0
      }

      const existingRow = this.tables.extraction_results.find((row) => row.id === id)
      const nextRow: ExtractionResultRow = {
        id: String(id),
        intake_job_id: String(intakeJobId),
        markdown_text: markdownText === null ? null : String(markdownText),
        structured_json: structuredJson === null ? null : String(structuredJson),
        raw_response: rawResponse === null ? null : String(rawResponse),
        schema_version: schemaVersion === null ? null : String(schemaVersion),
        created_at: String(createdAt),
      }

      if (existingRow) {
        Object.assign(existingRow, nextRow, { intake_job_id: existingRow.intake_job_id })
      } else {
        this.tables.extraction_results.push(nextRow)
      }
      return 1
    }

    if (sql.includes('insert into "extraction_results"')) {
      const [
        id,
        intakeJobId,
        markdownText,
        structuredJson,
        rawResponse,
        schemaVersion,
        createdAt,
      ] = this.params
      const existingRow = this.tables.extraction_results.find((row) => row.id === id)
      const nextRow: ExtractionResultRow = {
        id: String(id),
        intake_job_id: String(intakeJobId),
        markdown_text: markdownText === null ? null : String(markdownText),
        structured_json: structuredJson === null ? null : String(structuredJson),
        raw_response: rawResponse === null ? null : String(rawResponse),
        schema_version: schemaVersion === null ? null : String(schemaVersion),
        created_at: String(createdAt),
      }

      if (existingRow) {
        Object.assign(existingRow, nextRow, { intake_job_id: existingRow.intake_job_id })
      } else {
        this.tables.extraction_results.push(nextRow)
      }
      return 1
    }

    if (sql.includes('update "intake_jobs"')) {
      const nextStage = String(this.params[0])
      const updatedAt = String(this.params[this.params.length - 3])
      const jobId = this.params[this.params.length - 2]
      const expectedStage = this.params[this.params.length - 1]
      const row = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === expectedStage,
      )

      if (!row) {
        return 0
      }

      row.stage = nextStage
      row.error_message = null
      row.updated_at = updatedAt

      if (sql.includes('"extractor_provider"')) {
        row.extractor_provider = String(this.params[1])
        row.extractor_model = String(this.params[2])
        row.confidence_score = Number(this.params[3])
      }
      return 1
    }

    if (sql.includes('update "source_documents"')) {
      const [status, sourceDocumentId] = this.params
      const row = this.tables.source_documents.find(
        (candidate) => candidate.id === sourceDocumentId,
      )

      if (!row) {
        return 0
      }

      row.status = String(status)
      return 1
    }

    if (
      sql.includes('invoice:queue-source-processed') ||
      sql.includes('invoice:queue-source-error')
    ) {
      const [sourceDocumentId, jobId] = this.params
      const expectedStage = sql.includes('invoice:queue-source-processed')
        ? 'needs_review'
        : 'error'
      const nextStatus = sql.includes('invoice:queue-source-processed')
        ? 'processed'
        : 'error'
      const job = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === expectedStage,
      )
      const row = this.tables.source_documents.find(
        (candidate) => candidate.id === sourceDocumentId,
      )

      if (!job || !row) {
        return 0
      }

      row.status = nextStatus
      return 1
    }

    if (sql.includes('invoice:update-intake-stage')) {
      const [stage, updatedAt, jobId] = this.params
      const row = this.tables.intake_jobs.find(
        (candidate) =>
          candidate.id === jobId &&
          (!sql.includes("stage != 'deleting'") || candidate.stage !== 'deleting'),
      )

      if (row) {
        row.stage = String(stage)
        row.error_message = null
        row.updated_at = String(updatedAt)
      }
      return row ? 1 : 0
    }

    if (sql.includes('invoice:delete-extractions')) {
      const [jobId] = this.params
      const beforeCount = this.tables.extraction_results.length
      this.tables.extraction_results = this.tables.extraction_results.filter(
        (row) => row.intake_job_id !== jobId,
      )
      return beforeCount - this.tables.extraction_results.length
    }

    if (sql.includes('invoice:delete-intake-claim')) {
      const [jobId] = this.params
      const row = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage !== 'ready',
      )

      if (!row) {
        return 0
      }

      row.stage = 'deleting'
      return 1
    }

    if (sql.includes('invoice:delete-intake-restore')) {
      const [stage, jobId] = this.params
      const row = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === 'deleting',
      )

      if (!row) {
        return 0
      }

      row.stage = String(stage)
      return 1
    }

    if (sql.includes('invoice:delete-intake-job')) {
      const [jobId] = this.params
      const beforeCount = this.tables.intake_jobs.length
      this.tables.intake_jobs = this.tables.intake_jobs.filter(
        (row) => row.id !== jobId || row.stage !== 'deleting',
      )
      return beforeCount - this.tables.intake_jobs.length
    }

    if (sql.includes('invoice:delete-source-document')) {
      const [sourceDocumentId] = this.params
      const beforeCount = this.tables.source_documents.length
      this.tables.source_documents = this.tables.source_documents.filter(
        (row) => row.id !== sourceDocumentId,
      )
      return beforeCount - this.tables.source_documents.length
    }

    if (sql.includes('invoice:upsert-invoice')) {
      const [
        id,
        intakeJobId,
        invoiceDate,
        supplierName,
        documentNumber,
        subtotalAmount,
        taxAmount,
        totalAmount,
        sourceDocumentId,
        now,
        guardJobId,
      ] = this.params
      const job = this.tables.intake_jobs.find(
        (candidate) => candidate.id === guardJobId && candidate.stage === 'ready',
      )

      if (!job) {
        return 0
      }

      const existingRow = this.tables.invoices.find((row) => row.id === id)
      const nextRow: InvoiceRow = {
        id: String(id),
        intake_job_id: String(intakeJobId),
        invoice_date: String(invoiceDate),
        supplier_name: String(supplierName),
        document_number: String(documentNumber),
        subtotal_amount: toNullableNumber(subtotalAmount),
        tax_amount: Number(taxAmount),
        total_amount: Number(totalAmount),
        payment_method: null,
        currency: 'EUR',
        source_document_id: String(sourceDocumentId),
        review_status: 'ready',
        created_at: String(now),
        updated_at: String(now),
      }

      if (existingRow) {
        Object.assign(existingRow, nextRow, { created_at: existingRow.created_at })
      } else {
        this.tables.invoices.push(nextRow)
      }
      return 1
    }

    if (sql.includes('invoice:delete-items')) {
      const [invoiceId] = this.params
      const beforeCount = this.tables.invoice_items.length
      this.tables.invoice_items = this.tables.invoice_items.filter(
        (row) => row.invoice_id !== invoiceId,
      )
      return beforeCount - this.tables.invoice_items.length
    }

    if (sql.includes('invoice:insert-item')) {
      const [
        id,
        invoiceId,
        rawProductName,
        rawQuantity,
        rawUnit,
        rawUnitPrice,
        rawLineTotal,
        ingredientId,
        normalizedQuantity,
        normalizedUnit,
        normalizedUnitPrice,
        mappingStatus,
      ] = this.params
      this.tables.invoice_items.push({
        id: String(id),
        invoice_id: String(invoiceId),
        raw_product_name: String(rawProductName),
        raw_quantity: toNullableNumber(rawQuantity),
        raw_unit: rawUnit === null ? null : String(rawUnit),
        raw_unit_price: toNullableNumber(rawUnitPrice),
        raw_line_total: toNullableNumber(rawLineTotal),
        ingredient_id: ingredientId === null ? null : String(ingredientId),
        normalized_quantity: toNullableNumber(normalizedQuantity),
        normalized_unit: normalizedUnit === null ? null : String(normalizedUnit),
        normalized_unit_price: toNullableNumber(normalizedUnitPrice),
        mapping_status: String(mappingStatus),
      })
      return 1
    }

    if (sql.includes('invoice:upsert-ledger')) {
      const [id, entryDate, amount, vendor, sourceId, now] = this.params
      const existingRow = this.tables.ledger_entries.find((row) => row.id === id)
      const nextRow: LedgerEntryRow = {
        id: String(id),
        entry_date: String(entryDate),
        entry_type: 'expense',
        category: 'purchase',
        amount: Number(amount),
        account: null,
        vendor: String(vendor),
        source_kind: 'invoice',
        source_id: String(sourceId),
        created_at: String(now),
      }

      if (existingRow) {
        Object.assign(existingRow, nextRow, { created_at: existingRow.created_at })
      } else {
        this.tables.ledger_entries.push(nextRow)
      }
      return 1
    }

    throw new Error(`Unhandled fake D1 mutation: ${sql}`)
  }
}

function toSalesResult(row: SalesDailyRow) {
  return {
    id: row.id,
    date: row.date,
    totalAmount: row.total_amount,
    bbvaAmount: row.bbva_amount,
    caixaAmount: row.caixa_amount,
    cashAmount: row.cash_amount,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at,
  }
}

function toNullableNumber(value: unknown) {
  if (value === null || typeof value === 'undefined') {
    return null
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

function createSalesRow(overrides: Partial<SalesDailyRow> = {}): SalesDailyRow {
  return {
    id: 'sales-2026-04-27',
    date: '2026-04-27',
    total_amount: 0,
    bbva_amount: 0,
    caixa_amount: 0,
    cash_amount: 0,
    status: 'submitted',
    note: '',
    source_document_id: null,
    updated_at: '2026-04-27T20:00:00.000Z',
    ...overrides,
  }
}

function createLedgerRow(overrides: Partial<LedgerEntryRow> = {}): LedgerEntryRow {
  return {
    id: `ledger-${overrides.entry_date ?? '2026-04-27'}`,
    entry_date: '2026-04-27',
    entry_type: 'expense',
    category: 'purchase',
    amount: 0,
    account: null,
    vendor: null,
    source_kind: 'manual',
    source_id: 'manual-1',
    created_at: '2026-04-27T20:00:00.000Z',
    ...overrides,
  }
}

function createSourceDocumentRow(
  overrides: Partial<SourceDocumentRow> = {},
): SourceDocumentRow {
  return {
    id: 'src-1',
    source_type: 'invoice-upload',
    document_type_guess: 'invoice',
    r2_key: 'raw-documents/2026/04/src-1-invoice.pdf',
    original_filename: 'invoice.pdf',
    mime_type: 'application/pdf',
    uploaded_by: null,
    status: 'processed',
    uploaded_at: '2026-04-27T10:00:00.000Z',
    ...overrides,
  }
}

function createIntakeJobRow(overrides: Partial<IntakeJobRow> = {}): IntakeJobRow {
  return {
    id: 'job-1',
    source_document_id: 'src-1',
    extractor_provider: 'heuristic',
    extractor_model: 'filename-fallback-v1',
    stage: 'needs_review',
    confidence_score: null,
    error_message: null,
    created_at: '2026-04-27T10:00:00.000Z',
    updated_at: '2026-04-27T10:00:00.000Z',
    ...overrides,
  }
}

function createIngredientRow(overrides: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'ingredient-1',
    name: 'Ingredient',
    category: null,
    base_unit: 'unit',
    is_focus: '0',
    price_lower_bound: null,
    price_upper_bound: null,
    notes: null,
    created_at: '2026-04-27T10:00:00.000Z',
    ...overrides,
  }
}

function createInvoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'inv-1',
    intake_job_id: 'job-1',
    invoice_date: '2026-04-27',
    supplier_name: 'Supplier',
    document_number: 'INV-1',
    subtotal_amount: null,
    tax_amount: 0,
    total_amount: 0,
    payment_method: null,
    currency: 'EUR',
    source_document_id: 'src-1',
    review_status: 'ready',
    created_at: '2026-04-27T10:00:00.000Z',
    updated_at: '2026-04-27T10:00:00.000Z',
    ...overrides,
  }
}

function createReadyReviewJob(): InvoiceReviewJob {
  return {
    jobId: 'job-1',
    fileName: 'invoice.pdf',
    uploadedAt: '2026-04-27T10:00:00.000Z',
    pageCount: 1,
    status: 'needs_review',
    stage: 'needs_review',
    errorMessage: null,
    header: {
      supplier: 'Makro Madrid',
      invoiceNo: 'MK-001',
      date: '2026-04-20',
      totalAmount: '121.00',
      taxAmount: '21.00',
      notes: '',
    },
    lineItems: [
      {
        id: 'line-1',
        name: 'Coke 330ml',
        qty: '10',
        unit: 'can',
        unitPrice: '10.00',
        ingredient: 'coke-330',
        matched: true,
      },
    ],
  }
}

function createFakeR2Bucket(
  objects: Record<string, { body: string; contentType: string }>,
) {
  const objectMap = new Map(Object.entries(objects))

  return {
    get: async (key: string) => {
      const object = objectMap.get(key)

      if (!object) {
        return null
      }

      return {
        httpMetadata: {
          contentType: object.contentType,
        },
        body: object.body,
        arrayBuffer: async () => new TextEncoder().encode(object.body).buffer,
      }
    },
    delete: async (key: string) => {
      objectMap.delete(key)
    },
  } as unknown as R2Bucket
}
