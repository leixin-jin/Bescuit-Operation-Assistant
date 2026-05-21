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
import { uploadInvoiceSourceDocument } from '@/lib/server/upload'

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
          vendor: 'Beer Supplier',
        }),
        createLedgerRow({
          entry_date: '2026-04-12',
          category: 'food',
          amount: 40,
          vendor: 'Food Supplier',
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
      { name: 'Beer Supplier', value: 60, percentage: 60 },
      { name: 'Food Supplier', value: 40, percentage: 40 },
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

describe('invoice upload D1 integration', () => {
  test('uploading identical file bytes reuses the existing intake job', async () => {
    const { env, tables } = createFakeD1Env()
    env.RAW_DOCUMENTS = createFakeR2Bucket({})
    env.INTAKE_QUEUE = createFakeQueue()

    const first = await uploadInvoiceSourceDocument({
      env,
      file: new File(['same-invoice-bytes'], 'invoice-a.pdf', {
        type: 'application/pdf',
      }),
    })
    const second = await uploadInvoiceSourceDocument({
      env,
      file: new File(['same-invoice-bytes'], 'invoice-b.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(second).toEqual(first)
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect(await env.RAW_DOCUMENTS.get(first.r2Key)).not.toBeNull()
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(1)
  })

  test('uploading identical file bytes recovers when the source hash insert races an active job', async () => {
    const { env, tables } = createFakeD1Env(
      {
        source_documents: [
          createSourceDocumentRow({
            id: 'src-race-upload',
            r2_key: 'raw-documents/2026/04/src-race-upload-invoice.pdf',
            content_hash:
              '12b3ba3abd0e3d9eb59c1e2804c29c15aa0eecb56a9db564214dcf59e2d05b92',
          }),
        ],
        intake_jobs: [
          createIntakeJobRow({
            id: 'job-race-upload',
            source_document_id: 'src-race-upload',
            stage: 'deleting',
          }),
        ],
      },
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (sql.includes('insert into "source_documents"')) {
            currentTables.intake_jobs[0].stage = 'queued'
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-race-upload-invoice.pdf': {
        body: 'race-invoice-bytes',
        contentType: 'application/pdf',
      },
    })
    env.INTAKE_QUEUE = createFakeQueue()

    const result = await uploadInvoiceSourceDocument({
      env,
      file: new File(['race-invoice-bytes'], 'invoice-race.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(result).toEqual({
      jobId: 'job-race-upload',
      sourceDocumentId: 'src-race-upload',
      r2Key: 'raw-documents/2026/04/src-race-upload-invoice.pdf',
    })
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(0)
  })

  test('uploading identical file bytes rejects while the existing intake job is deleting', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-deleting-upload',
          r2_key: 'raw-documents/2026/04/src-deleting-upload-invoice.pdf',
          content_hash:
            '0c8583d7b3069dfdbd0d3e3242580061094ca854eaaf7023ba62e982fd4ef44c',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-deleting-upload',
          source_document_id: 'src-deleting-upload',
          stage: 'deleting',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({})
    env.INTAKE_QUEUE = createFakeQueue()

    await expect(
      uploadInvoiceSourceDocument({
        env,
        file: new File(['deleting-invoice-bytes'], 'invoice-deleting.pdf', {
          type: 'application/pdf',
        }),
      }),
    ).rejects.toThrow(/delet/i)

    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0]).toMatchObject({
      id: 'job-deleting-upload',
      stage: 'deleting',
    })
    expect(tables.source_documents[0].r2_key).toBe(
      'raw-documents/2026/04/src-deleting-upload-invoice.pdf',
    )
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(0)
  })

  test('uploading identical file bytes reuses an error job when requeueing the existing source', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-error-upload',
          r2_key: 'raw-documents/2026/04/src-error-upload-invoice.pdf',
          content_hash:
            'b6a8bde8e5eb8b31b8e234613e171ed35db55093907fcf29ac2201b6e4c17f06',
          status: 'error',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-error-upload',
          source_document_id: 'src-error-upload',
          stage: 'error',
          error_message: 'Queue unavailable',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-error-upload-invoice.pdf': {
        body: 'errored-invoice-bytes',
        contentType: 'application/pdf',
      },
    })
    env.INTAKE_QUEUE = createFakeQueue()

    const result = await uploadInvoiceSourceDocument({
      env,
      file: new File(['errored-invoice-bytes'], 'invoice-retry.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(result.sourceDocumentId).toBe('src-error-upload')
    expect(result.r2Key).toBe('raw-documents/2026/04/src-error-upload-invoice.pdf')
    expect(result.jobId).toBe('job-error-upload')
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.source_documents[0].status).toBe('uploaded')
    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0]).toMatchObject({
      id: 'job-error-upload',
      source_document_id: 'src-error-upload',
      stage: 'queued',
      error_message: null,
    })
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toEqual([
      {
        jobId: result.jobId,
        sourceDocumentId: 'src-error-upload',
        r2Key: 'raw-documents/2026/04/src-error-upload-invoice.pdf',
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      },
    ])
  })

  test('uploading identical file bytes reuses the active job when normal job insert loses the source-row race', async () => {
    const { env, tables } = createFakeD1Env(
      {},
      {
        beforeMutation: ({ sql, tables: currentTables }) => {
          if (
            sql.includes('invoice-upload:insert-job-if-no-active') &&
            currentTables.intake_jobs.length === 0
          ) {
            const sourceDocument = currentTables.source_documents[0]

            if (sourceDocument) {
              currentTables.intake_jobs.push(
                createIntakeJobRow({
                  id: 'job-race-winner',
                  source_document_id: sourceDocument.id,
                  stage: 'queued',
                }),
              )
            }
          }
        },
      },
    )
    env.RAW_DOCUMENTS = createFakeR2Bucket({})
    env.INTAKE_QUEUE = createFakeQueue()

    const result = await uploadInvoiceSourceDocument({
      env,
      file: new File(['new-race-invoice-bytes'], 'invoice-race.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(result).toEqual({
      jobId: 'job-race-winner',
      sourceDocumentId: tables.source_documents[0].id,
      r2Key: tables.source_documents[0].r2_key,
    })
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(0)
  })

  test('uploading identical file bytes recovers a duplicate even when cleanup delete fails', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-cleanup-fail',
          r2_key: 'raw-documents/2026/04/src-cleanup-fail-invoice.pdf',
          content_hash:
            '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-cleanup-fail',
          source_document_id: 'src-cleanup-fail',
          stage: 'queued',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket(
      {
        'raw-documents/2026/04/src-cleanup-fail-invoice.pdf': {
          body: '1234',
          contentType: 'application/pdf',
        },
      },
      { failDelete: true },
    )
    env.INTAKE_QUEUE = createFakeQueue()

    const result = await uploadInvoiceSourceDocument({
      env,
      file: new File(['1234'], 'invoice-cleanup.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(result).toEqual({
      jobId: 'job-cleanup-fail',
      sourceDocumentId: 'src-cleanup-fail',
      r2Key: 'raw-documents/2026/04/src-cleanup-fail-invoice.pdf',
    })
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(0)
  })

  test('uploading identical file bytes heals a missing old R2 object before retrying an error job', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-missing-old-object',
          r2_key: 'raw-documents/2026/04/src-missing-old-object-invoice.pdf',
          content_hash:
            'cbc61c4e48ac37759a3d8e9ac7e0e57b755b97c8dfa7342f58ea1c41348dfaee',
          status: 'error',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-missing-old-object',
          source_document_id: 'src-missing-old-object',
          stage: 'error',
          error_message: 'R2 object not found',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({})
    env.INTAKE_QUEUE = createFakeQueue()

    const result = await uploadInvoiceSourceDocument({
      env,
      file: new File(['missing-old-object-bytes'], 'invoice-retry.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(result.jobId).toBe('job-missing-old-object')
    expect(result.sourceDocumentId).toBe('src-missing-old-object')
    expect(result.r2Key).not.toBe(
      'raw-documents/2026/04/src-missing-old-object-invoice.pdf',
    )
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.source_documents[0]).toMatchObject({
      id: 'src-missing-old-object',
      r2_key: result.r2Key,
      status: 'uploaded',
    })
    expect(await env.RAW_DOCUMENTS.head(result.r2Key)).not.toBeNull()
    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0]).toMatchObject({
      id: 'job-missing-old-object',
      stage: 'queued',
      error_message: null,
    })
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toEqual([
      {
        jobId: 'job-missing-old-object',
        sourceDocumentId: 'src-missing-old-object',
        r2Key: result.r2Key,
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      },
    ])
  })

  test('uploading identical file bytes preserves a healed R2 object when queue send fails', async () => {
    const oldR2Key =
      'raw-documents/2026/04/src-missing-old-object-queue-fail-invoice.pdf'
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-missing-old-object-queue-fail',
          r2_key: oldR2Key,
          content_hash:
            '8af8156ccc437479646494ef7f4d4305ecab9a55442eaefad91b4b972dab51b2',
          status: 'error',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-missing-old-object-queue-fail',
          source_document_id: 'src-missing-old-object-queue-fail',
          stage: 'error',
          error_message: 'R2 object not found',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({})
    env.INTAKE_QUEUE = createFakeQueue({ failSend: true })

    await expect(
      uploadInvoiceSourceDocument({
        env,
        file: new File(
          ['queue-failure-missing-old-object-bytes'],
          'invoice-retry.pdf',
          {
            type: 'application/pdf',
          },
        ),
      }),
    ).rejects.toThrow('Queue send failed')

    const healedR2Key = tables.source_documents[0].r2_key
    expect(healedR2Key).not.toBeNull()
    expect(healedR2Key).not.toBe(oldR2Key)
    expect(tables.source_documents[0]).toMatchObject({
      id: 'src-missing-old-object-queue-fail',
      r2_key: healedR2Key,
      status: 'error',
    })
    expect(await env.RAW_DOCUMENTS.head(healedR2Key as string)).not.toBeNull()
    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0]).toMatchObject({
      id: 'job-missing-old-object-queue-fail',
      stage: 'error',
    })
  })

  test('uploading identical file bytes creates one queued job for an existing source without jobs', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-orphan-upload',
          r2_key: 'raw-documents/2026/04/src-orphan-upload-invoice.pdf',
          content_hash:
            'd6424bee8353574cb308572b94ce9e4c5fcaf48aee323a568631cf1ae2ff2153',
          status: 'uploaded',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-orphan-upload-invoice.pdf': {
        body: 'orphan-source-bytes',
        contentType: 'application/pdf',
      },
    })
    env.INTAKE_QUEUE = createFakeQueue()

    const result = await uploadInvoiceSourceDocument({
      env,
      file: new File(['orphan-source-bytes'], 'invoice-orphan.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(result).toEqual({
      jobId: tables.intake_jobs[0]?.id,
      sourceDocumentId: 'src-orphan-upload',
      r2Key: 'raw-documents/2026/04/src-orphan-upload-invoice.pdf',
    })
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0]).toMatchObject({
      source_document_id: 'src-orphan-upload',
      stage: 'queued',
    })
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toEqual([
      {
        jobId: result.jobId,
        sourceDocumentId: 'src-orphan-upload',
        r2Key: 'raw-documents/2026/04/src-orphan-upload-invoice.pdf',
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      },
    ])
  })

  test('parallel retries of identical error-stage bytes reuse one queued job', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-parallel-error',
          r2_key: 'raw-documents/2026/04/src-parallel-error-invoice.pdf',
          content_hash:
            'd77acb86e3042205b2011e924b32f4b01c930f7fdd2ee2f2ed9899ab0b564d00',
          status: 'error',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-parallel-error',
          source_document_id: 'src-parallel-error',
          stage: 'error',
          error_message: 'Queue unavailable',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-parallel-error-invoice.pdf': {
        body: 'parallel-error-bytes',
        contentType: 'application/pdf',
      },
    })
    env.INTAKE_QUEUE = createFakeQueue()

    const [first, second] = await Promise.all([
      uploadInvoiceSourceDocument({
        env,
        file: new File(['parallel-error-bytes'], 'invoice-a.pdf', {
          type: 'application/pdf',
        }),
      }),
      uploadInvoiceSourceDocument({
        env,
        file: new File(['parallel-error-bytes'], 'invoice-b.pdf', {
          type: 'application/pdf',
        }),
      }),
    ])

    expect(first).toEqual(second)
    expect(first).toEqual({
      jobId: 'job-parallel-error',
      sourceDocumentId: 'src-parallel-error',
      r2Key: 'raw-documents/2026/04/src-parallel-error-invoice.pdf',
    })
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.intake_jobs[0]).toMatchObject({
      id: 'job-parallel-error',
      stage: 'queued',
      error_message: null,
    })
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(1)
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
      ingredient_id: null,
      mapping_status: 'unmatched',
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

  test('confirming the same job after invoice identity correction updates the existing invoice', async () => {
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
        createExtractionResultRow({
          id: 'ext-job-1',
          intake_job_id: 'job-1',
        }),
      ],
    })
    const originalJob = createReadyReviewJob()
    const correctedJob = createReadyReviewJob({
      header: {
        supplier: 'Makro Alcala',
        invoiceNo: 'MK-002',
        date: '2026-04-21',
        totalAmount: '242.00',
        taxAmount: '42.00',
      },
      lineItems: [
        {
          id: 'line-2',
          name: 'Fanta 330ml',
          qty: '20',
          unit: 'can',
          unitPrice: '10.00',
          lineTotal: '200.00',
          taxRate: '21%',
          notes: '',
          ingredient: '',
          matched: false,
        },
      ],
    })

    await expect(confirmInvoiceReviewJobInDatabase(env, originalJob)).resolves.toMatchObject({
      ok: true,
    })
    const invoiceId = tables.invoices[0]?.id

    await expect(
      confirmInvoiceReviewJobInDatabase(env, correctedJob),
    ).resolves.toMatchObject({
      ok: true,
    })

    expect(tables.invoices).toHaveLength(1)
    expect(tables.invoices[0]).toMatchObject({
      id: invoiceId,
      intake_job_id: 'job-1',
      supplier_name: 'Makro Alcala',
      document_number: 'MK-002',
      invoice_date: '2026-04-21',
      total_amount: 242,
      tax_amount: 42,
      dedupe_key: 'makro alcala|MK-002|2026-04-21',
    })
    expect(tables.invoice_items).toHaveLength(1)
    expect(tables.invoice_items[0]).toMatchObject({
      invoice_id: invoiceId,
      raw_product_name: 'Fanta 330ml',
      raw_quantity: 20,
    })
    expect(tables.ledger_entries).toHaveLength(1)
    expect(tables.ledger_entries[0]).toMatchObject({
      id: `ledger_${invoiceId}`,
      entry_date: '2026-04-21',
      amount: 242,
      vendor: 'Makro Alcala',
      source_id: invoiceId,
    })
  })

  test('confirming the same supplier invoice from two jobs reuses invoice and ledger rows', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-a',
          original_filename: 'invoice-a.pdf',
        }),
        createSourceDocumentRow({
          id: 'src-b',
          original_filename: 'invoice-b.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-a',
          source_document_id: 'src-a',
          stage: 'needs_review',
        }),
        createIntakeJobRow({
          id: 'job-b',
          source_document_id: 'src-b',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        createExtractionResultRow({
          id: 'ext-job-a',
          intake_job_id: 'job-a',
        }),
        createExtractionResultRow({
          id: 'ext-job-b',
          intake_job_id: 'job-b',
        }),
      ],
    })
    const firstJob = createReadyReviewJob({ jobId: 'job-a', fileName: 'invoice-a.pdf' })
    const secondJob = createReadyReviewJob({
      jobId: 'job-b',
      fileName: 'invoice-b.pdf',
      lineItems: [
        {
          id: 'line-b',
          name: 'Sprite 330ml',
          qty: '5',
          unit: 'can',
          unitPrice: '20.00',
          lineTotal: '100.00',
          taxRate: '21%',
          notes: '',
          ingredient: '',
          matched: false,
        },
      ],
    })

    await expect(confirmInvoiceReviewJobInDatabase(env, firstJob)).resolves.toMatchObject({
      ok: true,
    })
    await expect(confirmInvoiceReviewJobInDatabase(env, secondJob)).resolves.toMatchObject({
      ok: true,
    })

    expect(tables.invoices).toHaveLength(1)
    expect(tables.invoice_items).toHaveLength(1)
    expect(tables.invoice_items[0]).toMatchObject({
      invoice_id: tables.invoices[0]?.id,
      raw_product_name: 'Sprite 330ml',
      raw_quantity: 5,
    })
    expect(tables.ledger_entries).toHaveLength(1)
    expect(tables.invoices[0]).toMatchObject({
      supplier_name: 'Makro Madrid',
      document_number: 'MK-001',
      invoice_date: '2026-04-20',
      total_amount: 121,
      dedupe_key: 'makro madrid|MK-001|2026-04-20',
    })
    expect(tables.ledger_entries[0]?.source_id).toBe(tables.invoices[0]?.id)
  })

  test('reconfirming the original duplicate job with a changed invoice keeps the shared duplicate invoice intact', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-a',
          original_filename: 'invoice-a.pdf',
        }),
        createSourceDocumentRow({
          id: 'src-b',
          original_filename: 'invoice-b.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-a',
          source_document_id: 'src-a',
          stage: 'needs_review',
        }),
        createIntakeJobRow({
          id: 'job-b',
          source_document_id: 'src-b',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        createExtractionResultRow({
          id: 'ext-job-a',
          intake_job_id: 'job-a',
        }),
        createExtractionResultRow({
          id: 'ext-job-b',
          intake_job_id: 'job-b',
        }),
      ],
    })
    const firstJob = createReadyReviewJob({ jobId: 'job-a', fileName: 'invoice-a.pdf' })
    const secondJob = createReadyReviewJob({
      jobId: 'job-b',
      fileName: 'invoice-b.pdf',
      lineItems: [
        {
          id: 'line-b',
          name: 'Sprite 330ml',
          qty: '5',
          unit: 'can',
          unitPrice: '20.00',
          lineTotal: '100.00',
          taxRate: '21%',
          notes: '',
          ingredient: '',
          matched: false,
        },
      ],
    })
    const correctedOriginalJob = createReadyReviewJob({
      jobId: 'job-a',
      fileName: 'invoice-a.pdf',
      header: {
        supplier: 'Makro Alcala',
        invoiceNo: 'MK-002',
        date: '2026-04-21',
        totalAmount: '242.00',
        taxAmount: '42.00',
      },
      lineItems: [
        {
          id: 'line-a-corrected',
          name: 'Fanta 330ml',
          qty: '20',
          unit: 'can',
          unitPrice: '10.00',
          lineTotal: '200.00',
          taxRate: '21%',
          notes: '',
          ingredient: '',
          matched: false,
        },
      ],
    })

    await expect(confirmInvoiceReviewJobInDatabase(env, firstJob)).resolves.toMatchObject({
      ok: true,
    })
    await expect(confirmInvoiceReviewJobInDatabase(env, secondJob)).resolves.toMatchObject({
      ok: true,
    })
    const sharedInvoiceId = tables.invoices[0]?.id

    await expect(
      confirmInvoiceReviewJobInDatabase(env, correctedOriginalJob),
    ).resolves.toMatchObject({
      ok: true,
    })

    const sharedInvoice = tables.invoices.find(
      (invoice) => invoice.dedupe_key === 'makro madrid|MK-001|2026-04-20',
    )
    const correctedInvoice = tables.invoices.find(
      (invoice) => invoice.dedupe_key === 'makro alcala|MK-002|2026-04-21',
    )

    expect(tables.invoices).toHaveLength(2)
    expect(sharedInvoice).toMatchObject({
      id: sharedInvoiceId,
      intake_job_id: 'job-b',
      source_document_id: 'src-b',
      supplier_name: 'Makro Madrid',
      document_number: 'MK-001',
      invoice_date: '2026-04-20',
      total_amount: 121,
    })
    expect(correctedInvoice).toMatchObject({
      intake_job_id: 'job-a',
      source_document_id: 'src-a',
      supplier_name: 'Makro Alcala',
      document_number: 'MK-002',
      invoice_date: '2026-04-21',
      total_amount: 242,
    })
    expect(correctedInvoice?.id).not.toBe(sharedInvoiceId)
    expect(tables.invoice_items).toHaveLength(2)
    expect(tables.invoice_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invoice_id: sharedInvoiceId,
          raw_product_name: 'Sprite 330ml',
          raw_quantity: 5,
        }),
        expect.objectContaining({
          invoice_id: correctedInvoice?.id,
          raw_product_name: 'Fanta 330ml',
          raw_quantity: 20,
        }),
      ]),
    )
    expect(tables.ledger_entries).toHaveLength(2)
    expect(tables.ledger_entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `ledger_${sharedInvoiceId}`,
          entry_date: '2026-04-20',
          amount: 121,
          vendor: 'Makro Madrid',
          source_id: sharedInvoiceId,
        }),
        expect.objectContaining({
          id: `ledger_${correctedInvoice?.id}`,
          entry_date: '2026-04-21',
          amount: 242,
          vendor: 'Makro Alcala',
          source_id: correctedInvoice?.id,
        }),
      ]),
    )
  })

  test('confirming an invoice no longer requires ingredient mapping and preserves stored tax-included totals', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [createSourceDocumentRow({ id: 'src-tax-included' })],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-tax-included',
          source_document_id: 'src-tax-included',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        {
          id: 'ext_job-tax-included',
          intake_job_id: 'job-tax-included',
          markdown_text: '',
          structured_json: JSON.stringify({
            schemaVersion: 'invoice-extraction-v2',
            pageCount: 1,
            documentKind: 'pdf',
            header: {
              supplier: 'VINOS ISABEL MARIA CRUSAT SA',
              invoiceNo: 'FP26020968',
              date: '2026-04-21',
              totalAmount: '106.67',
              taxAmount: '18.51',
              notes: '',
            },
            lineItems: [
              {
                id: '802',
                name: 'ESTRELLA GALICIA 24x33 cl. RET',
                qty: '4.00',
                unit: 'un',
                unitPrice: '25.61',
                lineTotal: '102.45',
                taxRate: '21%',
                notes: 'Descuento: 42,33',
                ingredient: '',
                matched: false,
              },
            ],
            markdownText: '',
            provider: 'gemini',
            model: 'gemini-3.1-flash-lite',
          }),
          raw_response: null,
          schema_version: 'invoice-extraction-v2',
          created_at: '2026-04-21T10:00:00.000Z',
        },
      ],
    })

    const result = await confirmInvoiceReviewJobInDatabase(env, {
      jobId: 'job-tax-included',
      fileName: 'Factura venta FP26020968.pdf',
      uploadedAt: '2026-04-21T10:00:00.000Z',
      pageCount: 1,
      status: 'needs_review',
      stage: 'needs_review',
      errorMessage: null,
      header: {
        supplier: 'VINOS ISABEL MARIA CRUSAT SA',
        invoiceNo: 'FP26020968',
        date: '2026-04-21',
        totalAmount: '106.67',
        taxAmount: '18.51',
        notes: '',
      },
      lineItems: [
        {
          id: '802',
          name: 'ESTRELLA GALICIA 24x33 cl. RET',
          qty: '4.00',
          unit: 'un',
          unitPrice: '25.61',
          lineTotal: '102.45',
          taxRate: '21%',
          notes: 'Descuento: 42,33',
          ingredient: '',
          matched: false,
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.readinessSummary.isReady).toBe(true)
    expect(tables.invoice_items[0]).toMatchObject({
      raw_unit_price: 25.61,
      raw_line_total: 102.45,
      ingredient_id: null,
      mapping_status: 'unmatched',
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
  content_hash: string | null
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
  dedupe_key: string
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
          vendor: row.vendor,
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

    if (sql.includes('invoice:get-persisted-invoice-id')) {
      const [dedupeKey] = this.params
      const invoice = this.tables.invoices.find((row) => row.dedupe_key === dedupeKey)
      return invoice ? [{ id: invoice.id }] : []
    }

    if (sql.includes('invoice:get-invoice-id')) {
      const [invoiceId] = this.params
      const invoice = this.tables.invoices.find((row) => row.id === invoiceId)
      return invoice ? [{ id: invoice.id }] : []
    }

    if (sql.includes('invoice:resolve-existing-invoice')) {
      const [jobId] = this.params
      return this.tables.invoices
        .filter((row) => row.intake_job_id === jobId)
        .slice(0, 1)
        .map((row) => ({ id: row.id }))
    }

    if (sql.includes('invoice-upload:find-duplicate')) {
      const [contentHash] = this.params
      return this.tables.intake_jobs
        .filter((job) =>
          ['queued', 'extracting', 'needs_review', 'ready'].includes(job.stage),
        )
        .map((job) => {
          const sourceDocument = this.tables.source_documents.find(
            (row) =>
              row.id === job.source_document_id &&
              row.content_hash === contentHash &&
              row.source_type === 'invoice-upload',
          )

          return sourceDocument
            ? {
                jobId: job.id,
                sourceDocumentId: sourceDocument.id,
                r2Key: sourceDocument.r2_key,
                createdAt: job.created_at,
              }
            : null
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 1)
        .map(({ createdAt: _createdAt, ...row }) => row)
    }

    if (sql.includes('invoice-upload:find-source-by-hash')) {
      const [contentHash] = this.params
      return this.tables.source_documents
        .filter(
          (row) =>
            row.content_hash === contentHash &&
            row.source_type === 'invoice-upload' &&
            row.r2_key !== null,
        )
        .slice()
        .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at))
        .slice(0, 1)
        .map((row) => ({
          sourceDocumentId: row.id,
          r2Key: row.r2_key,
          fileName: row.original_filename,
          mimeType: row.mime_type,
          uploadedAt: row.uploaded_at,
        }))
    }

    if (sql.includes('invoice-upload:find-active-by-source')) {
      const [sourceDocumentId] = this.params
      return this.tables.intake_jobs
        .filter(
          (job) =>
            job.source_document_id === sourceDocumentId &&
            ['queued', 'extracting', 'needs_review', 'ready'].includes(job.stage),
        )
        .map((job) => {
          const sourceDocument = this.tables.source_documents.find(
            (row) => row.id === job.source_document_id,
          )

          return sourceDocument
            ? {
                jobId: job.id,
                sourceDocumentId: sourceDocument.id,
                r2Key: sourceDocument.r2_key,
                fileName: sourceDocument.original_filename,
                mimeType: sourceDocument.mime_type,
                uploadedAt: sourceDocument.uploaded_at,
                createdAt: job.created_at,
              }
            : null
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 1)
        .map(({ createdAt: _createdAt, ...row }) => row)
    }

    if (sql.includes('invoice-upload:find-error-job-by-source')) {
      const [sourceDocumentId] = this.params
      return this.tables.intake_jobs
        .filter(
          (job) =>
            job.source_document_id === sourceDocumentId && job.stage === 'error',
        )
        .slice()
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, 1)
        .map((job) => ({
          jobId: job.id,
        }))
    }

    if (sql.includes('invoice-upload:find-deleting-by-source')) {
      const [sourceDocumentId] = this.params
      return this.tables.intake_jobs
        .filter(
          (job) =>
            job.source_document_id === sourceDocumentId && job.stage === 'deleting',
        )
        .slice()
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, 1)
        .map((job) => ({
          jobId: job.id,
        }))
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

    if (sql.includes('insert into "source_documents"')) {
      const [
        id,
        sourceType,
        documentTypeGuess,
        r2Key,
        originalFilename,
        mimeType,
        maybeContentHash,
        maybeUploadedBy,
        maybeStatus,
        maybeUploadedAt,
      ] = this.params
      const hasContentHash = this.params.length === 10
      const contentHash = hasContentHash
        ? maybeContentHash === null
          ? null
          : String(maybeContentHash)
        : null

      if (
        contentHash !== null &&
        this.tables.source_documents.some((row) => row.content_hash === contentHash)
      ) {
        throw new Error('D1_ERROR: UNIQUE constraint failed: source_documents.content_hash')
      }

      this.tables.source_documents.push({
        id: String(id),
        source_type: String(sourceType),
        document_type_guess: String(documentTypeGuess),
        r2_key: r2Key === null ? null : String(r2Key),
        original_filename: String(originalFilename),
        mime_type: mimeType === null ? null : String(mimeType),
        content_hash: contentHash,
        uploaded_by: (hasContentHash ? maybeUploadedBy : maybeContentHash) === null
          ? null
          : String(hasContentHash ? maybeUploadedBy : maybeContentHash),
        status: String(hasContentHash ? maybeStatus : maybeUploadedBy),
        uploaded_at: String(hasContentHash ? maybeUploadedAt : maybeStatus),
      })
      return 1
    }

    if (sql.includes('invoice-upload:insert-job-if-no-active')) {
      const [
        id,
        sourceDocumentId,
        extractorProvider,
        extractorModel,
        createdAt,
        updatedAt,
        guardSourceDocumentId,
      ] = this.params
      const hasBlockingJob = this.tables.intake_jobs.some(
        (row) =>
          row.source_document_id === guardSourceDocumentId &&
          ['queued', 'extracting', 'needs_review', 'ready', 'deleting'].includes(
            row.stage,
          ),
      )

      if (hasBlockingJob) {
        return 0
      }

      this.tables.intake_jobs.push({
        id: String(id),
        source_document_id: String(sourceDocumentId),
        extractor_provider:
          extractorProvider === null ? null : String(extractorProvider),
        extractor_model: extractorModel === null ? null : String(extractorModel),
        stage: 'queued',
        confidence_score: null,
        error_message: null,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      })
      return 1
    }

    if (sql.includes('insert into "intake_jobs"')) {
      const [
        id,
        sourceDocumentId,
        extractorProvider,
        extractorModel,
        stage,
        createdAt,
        updatedAt,
      ] = this.params
      this.tables.intake_jobs.push({
        id: String(id),
        source_document_id: String(sourceDocumentId),
        extractor_provider:
          extractorProvider === null ? null : String(extractorProvider),
        extractor_model: extractorModel === null ? null : String(extractorModel),
        stage: String(stage),
        confidence_score: null,
        error_message: null,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      })
      return 1
    }

    if (sql.includes('invoice-upload:requeue-error-job-if-no-active')) {
      const [
        extractorProvider,
        extractorModel,
        updatedAt,
        jobId,
        sourceDocumentId,
        guardSourceDocumentId,
      ] = this.params
      const hasBlockingJob = this.tables.intake_jobs.some(
        (row) =>
          row.source_document_id === guardSourceDocumentId &&
          ['queued', 'extracting', 'needs_review', 'ready', 'deleting'].includes(
            row.stage,
          ),
      )

      if (hasBlockingJob) {
        return 0
      }

      const row = this.tables.intake_jobs.find(
        (candidate) =>
          candidate.id === jobId &&
          candidate.source_document_id === sourceDocumentId &&
          candidate.stage === 'error',
      )

      if (!row) {
        return 0
      }

      row.stage = 'queued'
      row.extractor_provider =
        extractorProvider === null ? null : String(extractorProvider)
      row.extractor_model = extractorModel === null ? null : String(extractorModel)
      row.confidence_score = null
      row.error_message = null
      row.updated_at = String(updatedAt)
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

    if (sql.includes('invoice-upload:update-source-r2-key')) {
      const [r2Key, sourceDocumentId] = this.params
      const row = this.tables.source_documents.find(
        (candidate) => candidate.id === sourceDocumentId,
      )

      if (!row) {
        return 0
      }

      row.r2_key = String(r2Key)
      row.status = 'uploaded'
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

    if (sql.includes('invoice:update-existing-invoice')) {
      const [
        intakeJobId,
        invoiceDate,
        supplierName,
        documentNumber,
        subtotalAmount,
        taxAmount,
        totalAmount,
        sourceDocumentId,
        dedupeKey,
        now,
        id,
        invoiceOwnerJobId,
        guardJobId,
      ] = this.params
      const job = this.tables.intake_jobs.find(
        (candidate) => candidate.id === guardJobId && candidate.stage === 'ready',
      )
      const existingRow = this.tables.invoices.find(
        (row) => row.id === id && row.intake_job_id === invoiceOwnerJobId,
      )

      if (!job || !existingRow) {
        return 0
      }

      if (
        this.tables.invoices.some(
          (row) => row.id !== existingRow.id && row.dedupe_key === dedupeKey,
        )
      ) {
        throw new Error('UNIQUE constraint failed: invoices.dedupe_key')
      }

      if (
        this.tables.invoices.some(
          (row) => row.id !== existingRow.id && row.intake_job_id === intakeJobId,
        )
      ) {
        throw new Error('UNIQUE constraint failed: invoices.intake_job_id')
      }

      Object.assign(existingRow, {
        intake_job_id: String(intakeJobId),
        dedupe_key: String(dedupeKey),
        invoice_date: String(invoiceDate),
        supplier_name: String(supplierName),
        document_number: String(documentNumber),
        subtotal_amount: toNullableNumber(subtotalAmount),
        tax_amount: Number(taxAmount),
        total_amount: Number(totalAmount),
        source_document_id: String(sourceDocumentId),
        review_status: 'ready',
        updated_at: String(now),
      })
      return 1
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
        dedupeKey,
        now,
        guardJobId,
      ] = this.params
      const job = this.tables.intake_jobs.find(
        (candidate) => candidate.id === guardJobId && candidate.stage === 'ready',
      )

      if (!job) {
        return 0
      }

      const existingRow = this.tables.invoices.find(
        (row) => row.dedupe_key === dedupeKey,
      )
      const nextRow: InvoiceRow = {
        id: String(id),
        intake_job_id: String(intakeJobId),
        dedupe_key: String(dedupeKey),
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
        const conflictingIntakeJob = this.tables.invoices.find(
          (row) => row.id !== existingRow.id && row.intake_job_id === intakeJobId,
        )

        if (conflictingIntakeJob) {
          throw new Error('UNIQUE constraint failed: invoices.intake_job_id')
        }

        Object.assign(existingRow, nextRow, {
          id: existingRow.id,
          created_at: existingRow.created_at,
        })
      } else {
        if (this.tables.invoices.some((row) => row.id === id)) {
          throw new Error('UNIQUE constraint failed: invoices.id')
        }

        if (this.tables.invoices.some((row) => row.intake_job_id === intakeJobId)) {
          throw new Error('UNIQUE constraint failed: invoices.intake_job_id')
        }

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
    content_hash: null,
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

function createExtractionResultRow(
  overrides: Partial<ExtractionResultRow> = {},
): ExtractionResultRow {
  return {
    id: 'ext-job-1',
    intake_job_id: 'job-1',
    markdown_text: '',
    structured_json: null,
    raw_response: null,
    schema_version: 'invoice-extraction-v1',
    created_at: '2026-04-27T10:00:00.000Z',
    ...overrides,
  }
}

function createInvoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'inv-1',
    intake_job_id: 'job-1',
    dedupe_key: 'supplier|INV-1|2026-04-27',
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

function createReadyReviewJob(
  overrides: Partial<Omit<InvoiceReviewJob, 'header' | 'lineItems'>> & {
    header?: Partial<InvoiceReviewJob['header']>
    lineItems?: InvoiceReviewJob['lineItems']
  } = {},
): InvoiceReviewJob {
  const header = {
    supplier: 'Makro Madrid',
    invoiceNo: 'MK-001',
    date: '2026-04-20',
    totalAmount: '121.00',
    taxAmount: '21.00',
    notes: '',
    ...overrides.header,
  }

  return {
    jobId: 'job-1',
    fileName: 'invoice.pdf',
    uploadedAt: '2026-04-27T10:00:00.000Z',
    pageCount: 1,
    status: 'needs_review',
    stage: 'needs_review',
    errorMessage: null,
    ...overrides,
    header,
    lineItems: overrides.lineItems ?? [
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
  options: { failDelete?: boolean } = {},
) {
  const objectMap = new Map(Object.entries(objects))

  return {
    head: async (key: string) => {
      const object = objectMap.get(key)

      if (!object) {
        return null
      }

      return {
        key,
        httpMetadata: {
          contentType: object.contentType,
        },
      }
    },
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
      if (options.failDelete) {
        throw new Error(`R2 delete failed: ${key}`)
      }

      objectMap.delete(key)
    },
    put: async (
      key: string,
      value: File,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      objectMap.set(key, {
        body: await value.text(),
        contentType:
          options?.httpMetadata?.contentType || value.type || 'application/octet-stream',
      })
    },
  } as unknown as R2Bucket
}

interface FakeQueue {
  sentMessages: unknown[]
  send: (message: unknown) => Promise<void>
}

function createFakeQueue(options: { failSend?: boolean } = {}): Queue & FakeQueue {
  const sentMessages: unknown[] = []

  return {
    sentMessages,
    send: async (message: unknown) => {
      if (options.failSend) {
        throw new Error('Queue send failed')
      }

      sentMessages.push(message)
    },
  } as Queue & FakeQueue
}
