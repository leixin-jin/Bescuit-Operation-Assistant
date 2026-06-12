import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AppBindings } from '@/lib/server/bindings'
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
import { recheckInvoiceReviewJobInDatabase } from '@/lib/server/mutations/invoices.rpc'

const providerExtractMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/invoice-extraction/providers', () => ({
  selectInvoiceExtractionProvider: vi.fn(() => ({
    id: 'heuristic-v1',
    model: 'filename-fallback-v1',
    extract: providerExtractMock,
  })),
}))

beforeEach(() => {
  providerExtractMock.mockReset()
  providerExtractMock.mockResolvedValue({
    draft: createProviderDraft('filename-fallback', '0.00'),
    rawResponse: 'filename-fallback default test extraction',
  })
})

describe('multi-invoice sibling persistence', () => {
  test('queue processing persists additional invoice drafts as sibling review jobs', async () => {
    const r2Key = 'raw-documents/2026/05/2605A008462-2605A008463.PDF'
    const fileName = '2605A008462-2605A008463.PDF'
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-multi-invoice-pdf',
          r2_key: r2Key,
          original_filename: fileName,
          mime_type: 'application/pdf',
          status: 'uploaded',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-multi-invoice-pdf',
          source_document_id: 'src-multi-invoice-pdf',
          stage: 'queued',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      [r2Key]: {
        body: '%PDF-multi-invoice',
        contentType: 'application/pdf',
      },
    })
    providerExtractMock.mockResolvedValueOnce({
      draft: createProviderDraft('2605A008462', '769.22'),
      rawResponse: 'primary invoice 2605A008462',
      additionalDrafts: [
        {
          pageNumber: 2,
          draft: createProviderDraft('2605A008463', '733.15', {
            markdownText: 'page 2 invoice 2605A008463',
          }),
          rawResponse: 'additional invoice 2605A008463',
        },
      ],
    })

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-multi-invoice-pdf',
        sourceDocumentId: 'src-multi-invoice-pdf',
        r2Key,
        fileName,
        mimeType: 'application/pdf',
        uploadedAt: '2026-05-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-multi-invoice-pdf',
      stage: 'needs_review',
    })

    expect(
      tables.intake_jobs
        .filter((row) => row.source_document_id === 'src-multi-invoice-pdf')
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((row) => ({ id: row.id, stage: row.stage })),
    ).toEqual([
      { id: 'job-multi-invoice-pdf', stage: 'needs_review' },
      { id: 'job-multi-invoice-pdf_p2', stage: 'needs_review' },
    ])

    expect(getExtractionInvoiceNumbers(tables)).toEqual([
      { id: 'ext_job-multi-invoice-pdf', invoiceNo: '2605A008462' },
      { id: 'ext_job-multi-invoice-pdf_p2', invoiceNo: '2605A008463' },
    ])
  })

  test('queue sibling upsert does not overwrite a ready sibling job', async () => {
    const r2Key = 'raw-documents/2026/05/ready-sibling.pdf'
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-ready-sibling',
          r2_key: r2Key,
          original_filename: 'ready-sibling.pdf',
          status: 'uploaded',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-ready-sibling',
          source_document_id: 'src-ready-sibling',
          stage: 'queued',
        }),
        createIntakeJobRow({
          id: 'job-ready-sibling_p2',
          source_document_id: 'src-ready-sibling',
          stage: 'ready',
          confidence_score: 0.99,
        }),
      ],
      extraction_results: [
        createExtractionResultRow({
          id: 'ext_job-ready-sibling_p2',
          intake_job_id: 'job-ready-sibling_p2',
          structured_json: JSON.stringify(createProviderDraft('OLD-P2', '20.00')),
          raw_response: 'old sibling',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      [r2Key]: {
        body: '%PDF-ready-sibling',
        contentType: 'application/pdf',
      },
    })
    providerExtractMock.mockResolvedValueOnce({
      draft: createProviderDraft('PRIMARY', '10.00'),
      rawResponse: 'primary',
      additionalDrafts: [
        {
          pageNumber: 2,
          draft: createProviderDraft('NEW-P2', '22.00'),
          rawResponse: 'new sibling',
        },
      ],
    })

    await processInvoiceIntakeQueueMessage(env, {
      jobId: 'job-ready-sibling',
      sourceDocumentId: 'src-ready-sibling',
      r2Key,
      fileName: 'ready-sibling.pdf',
      mimeType: 'application/pdf',
      uploadedAt: '2026-05-27T10:00:00.000Z',
    })

    expect(tables.intake_jobs.find((row) => row.id === 'job-ready-sibling_p2')).toMatchObject({
      stage: 'ready',
      confidence_score: 0.99,
    })
    expect(
      JSON.parse(
        tables.extraction_results.find((row) => row.id === 'ext_job-ready-sibling_p2')
          ?.structured_json ?? '{}',
      ).header?.invoiceNo,
    ).toBe('OLD-P2')
  })

  test('recheck overwrites affected ready sibling after clearing its accounting rows', async () => {
    const r2Key = 'raw-documents/2026/05/recheck-ready-sibling.pdf'
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-recheck-ready-sibling',
          r2_key: r2Key,
          original_filename: 'recheck-ready-sibling.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-recheck-ready-sibling',
          source_document_id: 'src-recheck-ready-sibling',
          stage: 'ready',
        }),
        createIntakeJobRow({
          id: 'job-recheck-ready-sibling_p2',
          source_document_id: 'src-recheck-ready-sibling',
          stage: 'ready',
        }),
      ],
      extraction_results: [
        createExtractionResultRow({
          id: 'ext_job-recheck-ready-sibling',
          intake_job_id: 'job-recheck-ready-sibling',
          structured_json: JSON.stringify(createProviderDraft('OLD-PRIMARY', '10.00')),
        }),
        createExtractionResultRow({
          id: 'ext_job-recheck-ready-sibling_p2',
          intake_job_id: 'job-recheck-ready-sibling_p2',
          structured_json: JSON.stringify(createProviderDraft('OLD-P2', '20.00')),
        }),
      ],
      invoices: [
        createInvoiceRow({
          id: 'inv_job-recheck-ready-sibling_p2',
          intake_job_id: 'job-recheck-ready-sibling_p2',
          source_document_id: 'src-recheck-ready-sibling',
        }),
      ],
      invoice_items: [
        createInvoiceItemRow({
          id: 'inv_job-recheck-ready-sibling_p2_item_1',
          invoice_id: 'inv_job-recheck-ready-sibling_p2',
        }),
      ],
      ledger_entries: [
        createLedgerRow({
          id: 'ledger_inv_job-recheck-ready-sibling_p2',
          source_kind: 'invoice',
          source_id: 'inv_job-recheck-ready-sibling_p2',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      [r2Key]: {
        body: '%PDF-recheck-ready-sibling',
        contentType: 'application/pdf',
      },
    })
    providerExtractMock.mockResolvedValueOnce({
      draft: createProviderDraft('NEW-PRIMARY', '11.00'),
      rawResponse: 'new primary',
      additionalDrafts: [
        {
          pageNumber: 2,
          draft: createProviderDraft('NEW-P2', '22.00'),
          rawResponse: 'new sibling p2',
        },
      ],
    })

    await recheckInvoiceReviewJobInDatabase(env, 'job-recheck-ready-sibling')

    expect(tables.intake_jobs.find((row) => row.id === 'job-recheck-ready-sibling_p2')).toMatchObject({
      stage: 'needs_review',
    })
    expect(
      JSON.parse(
        tables.extraction_results.find(
          (row) => row.id === 'ext_job-recheck-ready-sibling_p2',
        )?.structured_json ?? '{}',
      ).header?.invoiceNo,
    ).toBe('NEW-P2')
    expect(tables.invoices).toHaveLength(0)
    expect(tables.invoice_items).toHaveLength(0)
    expect(tables.ledger_entries).toHaveLength(0)
  })

  test('recheck removes stale non-ready sibling jobs when current extraction has no additional drafts', async () => {
    const r2Key = 'raw-documents/2026/05/recheck-stale-sibling.pdf'
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-recheck-stale-sibling',
          r2_key: r2Key,
          original_filename: 'recheck-stale-sibling.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-recheck-stale-sibling',
          source_document_id: 'src-recheck-stale-sibling',
          stage: 'needs_review',
        }),
        createIntakeJobRow({
          id: 'job-recheck-stale-sibling_p2',
          source_document_id: 'src-recheck-stale-sibling',
          stage: 'needs_review',
        }),
        createIntakeJobRow({
          id: 'job-recheck-stale-sibling_p3',
          source_document_id: 'src-recheck-stale-sibling',
          stage: 'ready',
        }),
      ],
      extraction_results: [
        createExtractionResultRow({
          id: 'ext_job-recheck-stale-sibling_p2',
          intake_job_id: 'job-recheck-stale-sibling_p2',
        }),
        createExtractionResultRow({
          id: 'ext_job-recheck-stale-sibling_p3',
          intake_job_id: 'job-recheck-stale-sibling_p3',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      [r2Key]: {
        body: '%PDF-recheck-stale-sibling',
        contentType: 'application/pdf',
      },
    })
    providerExtractMock.mockResolvedValueOnce({
      draft: createProviderDraft('ONLY-PRIMARY', '11.00'),
      rawResponse: 'only primary',
    })

    await recheckInvoiceReviewJobInDatabase(env, 'job-recheck-stale-sibling')

    expect(tables.intake_jobs.map((row) => row.id).sort()).toEqual([
      'job-recheck-stale-sibling',
      'job-recheck-stale-sibling_p3',
    ])
    expect(tables.extraction_results.map((row) => row.intake_job_id).sort()).toEqual([
      'job-recheck-stale-sibling',
      'job-recheck-stale-sibling_p3',
    ])
  })
})

interface FakeTables {
  source_documents: SourceDocumentRow[]
  intake_jobs: IntakeJobRow[]
  extraction_results: ExtractionResultRow[]
  invoices: InvoiceRow[]
  invoice_items: InvoiceItemRow[]
  ledger_entries: LedgerEntryRow[]
}

type FakeTableInput = Partial<{ [K in keyof FakeTables]: FakeTables[K] }>

interface SourceDocumentRow {
  id: string
  r2_key: string | null
  original_filename: string
  mime_type: string | null
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

interface InvoiceRow {
  id: string
  intake_job_id: string | null
  source_document_id: string | null
}

interface InvoiceItemRow {
  id: string
  invoice_id: string
}

interface LedgerEntryRow {
  id: string
  source_kind: string
  source_id: string
}

function createFakeD1Env(initialTables: FakeTableInput = {}) {
  const tables: FakeTables = {
    source_documents: initialTables.source_documents ?? [],
    intake_jobs: initialTables.intake_jobs ?? [],
    extraction_results: initialTables.extraction_results ?? [],
    invoices: initialTables.invoices ?? [],
    invoice_items: initialTables.invoice_items ?? [],
    ledger_entries: initialTables.ledger_entries ?? [],
  }

  return {
    env: {
      DB: new FakeD1Database(tables) as unknown as D1Database,
      MODE: 'test',
    } satisfies Partial<AppBindings> as AppBindings,
    tables,
  }
}

class FakeD1Database {
  constructor(private tables: FakeTables) {}

  prepare(sql: string) {
    return new FakeD1PreparedStatement(this.tables, sql)
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
    private tables: FakeTables,
    private sql: string,
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

  async raw() {
    return this.selectRows().map((row) => Object.values(row))
  }

  async run() {
    return {
      success: true,
      meta: { changes: this.mutateRows() },
    }
  }

  private selectRows() {
    const sql = this.sql

    if (sql.includes('select "stage"') && sql.includes('from "intake_jobs"')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      return job ? [{ stage: job.stage }] : []
    }

    if (sql.includes('invoice:recheck-source')) {
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
              fileName: sourceDocument.original_filename,
              mimeType: sourceDocument.mime_type,
              uploadedAt: sourceDocument.uploaded_at,
            },
          ]
        : []
    }

    if (sql.includes('invoice:recheck-list-siblings')) {
      const [sourceDocumentId, jobIdPattern] = this.params
      const jobIdPrefix = String(jobIdPattern).replace(/%$/, '')
      return this.tables.intake_jobs
        .filter(
          (row) =>
            row.source_document_id === sourceDocumentId &&
            row.id.startsWith(jobIdPrefix),
        )
        .map((row) => ({
          jobId: row.id,
          stage: row.stage,
        }))
    }

    throw new Error(`Unhandled fake D1 select: ${sql}`)
  }

  private mutateRows() {
    const sql = this.sql

    if (
      sql.includes('invoice:queue-upsert-extraction') ||
      sql.includes('invoice:recheck-upsert-extraction')
    ) {
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

      upsertExtraction(this.tables, {
        id: String(id),
        intake_job_id: String(intakeJobId),
        markdown_text: nullableString(markdownText),
        structured_json: nullableString(structuredJson),
        raw_response: nullableString(rawResponse),
        schema_version: nullableString(schemaVersion),
        created_at: String(createdAt),
      })
      return 1
    }

    if (sql.includes('invoice:persist-additional-intake-job')) {
      const [
        id,
        sourceDocumentId,
        extractorProvider,
        extractorModel,
        confidenceScore,
        createdAt,
        updatedAt,
      ] = this.params
      const existingRow = this.tables.intake_jobs.find((row) => row.id === id)

      if (existingRow?.stage === 'ready' && !sql.includes('allow-ready-overwrite')) {
        return 0
      }

      if (existingRow) {
        existingRow.extractor_provider = String(extractorProvider)
        existingRow.extractor_model = String(extractorModel)
        existingRow.stage = 'needs_review'
        existingRow.confidence_score = Number(confidenceScore)
        existingRow.error_message = null
        existingRow.updated_at = String(updatedAt)
      } else {
        this.tables.intake_jobs.push({
          id: String(id),
          source_document_id: String(sourceDocumentId),
          extractor_provider: String(extractorProvider),
          extractor_model: String(extractorModel),
          stage: 'needs_review',
          confidence_score: Number(confidenceScore),
          error_message: null,
          created_at: String(createdAt),
          updated_at: String(updatedAt),
        })
      }
      return 1
    }

    if (sql.includes('invoice:persist-additional-extraction')) {
      const [
        id,
        intakeJobId,
        markdownText,
        structuredJson,
        rawResponse,
        schemaVersion,
        createdAt,
      ] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === intakeJobId)

      if (job?.stage === 'ready' && !sql.includes('allow-ready-overwrite')) {
        return 0
      }

      upsertExtraction(this.tables, {
        id: String(id),
        intake_job_id: String(intakeJobId),
        markdown_text: nullableString(markdownText),
        structured_json: nullableString(structuredJson),
        raw_response: nullableString(rawResponse),
        schema_version: nullableString(schemaVersion),
        created_at: String(createdAt),
      })
      return 1
    }

    if (sql.includes('update "intake_jobs"')) {
      const updatedAt = String(this.params[this.params.length - 3])
      const jobId = this.params[this.params.length - 2]
      const expectedStage = this.params[this.params.length - 1]
      const row = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === expectedStage,
      )

      if (!row) {
        return 0
      }

      row.stage = sql.includes('"extractor_provider"')
        ? 'needs_review'
        : String(this.params[0])
      row.error_message = null
      row.updated_at = updatedAt

      if (sql.includes('"extractor_provider"')) {
        row.extractor_provider = String(this.params[0])
        row.extractor_model = String(this.params[1])
        row.confidence_score = Number(this.params[2])
      }
      return 1
    }

    if (sql.includes('invoice:queue-source-processed')) {
      const [sourceDocumentId, jobId] = this.params
      const job = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === 'needs_review',
      )
      const row = this.tables.source_documents.find(
        (candidate) => candidate.id === sourceDocumentId,
      )

      if (!job || !row) {
        return 0
      }

      row.status = 'processed'
      return 1
    }

    if (sql.includes('invoice:recheck-start')) {
      const [updatedAt, jobId] = this.params
      const row = this.tables.intake_jobs.find(
        (candidate) =>
          candidate.id === jobId &&
          !['queued', 'extracting', 'deleting'].includes(candidate.stage),
      )

      if (!row) {
        return 0
      }

      row.stage = 'extracting'
      row.error_message = null
      row.updated_at = String(updatedAt)
      return 1
    }

    if (sql.includes('invoice:recheck-finish')) {
      const [provider, model, confidenceScore, updatedAt, jobId] = this.params
      const row = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === 'extracting',
      )

      if (!row) {
        return 0
      }

      row.stage = 'needs_review'
      row.extractor_provider = String(provider)
      row.extractor_model = String(model)
      row.confidence_score = Number(confidenceScore)
      row.error_message = null
      row.updated_at = String(updatedAt)
      return 1
    }

    if (sql.includes('invoice:recheck-source-processed')) {
      const [sourceDocumentId] = this.params
      const row = this.tables.source_documents.find(
        (candidate) => candidate.id === sourceDocumentId,
      )

      if (!row) {
        return 0
      }

      row.status = 'processed'
      return 1
    }

    if (sql.includes('invoice:recheck-delete-ledger')) {
      const [ledgerEntryId] = this.params
      const beforeCount = this.tables.ledger_entries.length
      this.tables.ledger_entries = this.tables.ledger_entries.filter(
        (row) => row.id !== ledgerEntryId,
      )
      return beforeCount - this.tables.ledger_entries.length
    }

    if (sql.includes('invoice:recheck-delete-items')) {
      const [invoiceId] = this.params
      const beforeCount = this.tables.invoice_items.length
      this.tables.invoice_items = this.tables.invoice_items.filter(
        (row) => row.invoice_id !== invoiceId,
      )
      return beforeCount - this.tables.invoice_items.length
    }

    if (sql.includes('invoice:recheck-delete-invoice')) {
      const [invoiceId] = this.params
      const beforeCount = this.tables.invoices.length
      this.tables.invoices = this.tables.invoices.filter((row) => row.id !== invoiceId)
      return beforeCount - this.tables.invoices.length
    }

    if (sql.includes('invoice:recheck-retire-stale-sibling-extractions')) {
      const jobIds = new Set(this.params.map(String))
      const beforeCount = this.tables.extraction_results.length
      this.tables.extraction_results = this.tables.extraction_results.filter(
        (row) =>
          !jobIds.has(row.intake_job_id) ||
          this.tables.intake_jobs.some(
            (job) => job.id === row.intake_job_id && job.stage === 'ready',
          ),
      )
      return beforeCount - this.tables.extraction_results.length
    }

    if (sql.includes('invoice:recheck-retire-stale-sibling-jobs')) {
      const jobIds = new Set(this.params.map(String))
      const beforeCount = this.tables.intake_jobs.length
      this.tables.intake_jobs = this.tables.intake_jobs.filter(
        (row) => !jobIds.has(row.id) || row.stage === 'ready',
      )
      return beforeCount - this.tables.intake_jobs.length
    }

    if (sql.includes('invoice:recheck-error')) {
      const [errorMessage, updatedAt, jobId] = this.params
      const row = this.tables.intake_jobs.find(
        (candidate) => candidate.id === jobId && candidate.stage === 'extracting',
      )

      if (!row) {
        return 0
      }

      row.stage = 'error'
      row.error_message = String(errorMessage)
      row.updated_at = String(updatedAt)
      return 1
    }

    if (sql.includes('invoice:recheck-source-error')) {
      return 1
    }

    throw new Error(`Unhandled fake D1 mutation: ${sql}`)
  }
}

function upsertExtraction(tables: FakeTables, nextRow: ExtractionResultRow) {
  const existingRow = tables.extraction_results.find((row) => row.id === nextRow.id)

  if (existingRow) {
    Object.assign(existingRow, nextRow, { intake_job_id: existingRow.intake_job_id })
  } else {
    tables.extraction_results.push(nextRow)
  }
}

function nullableString(value: unknown) {
  return value === null ? null : String(value)
}

function getExtractionInvoiceNumbers(tables: FakeTables) {
  return tables.extraction_results
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => ({
      id: row.id,
      invoiceNo: JSON.parse(row.structured_json ?? '{}').header?.invoiceNo,
    }))
}

function createSourceDocumentRow(
  overrides: Partial<SourceDocumentRow> = {},
): SourceDocumentRow {
  return {
    id: 'src-1',
    r2_key: 'raw-documents/2026/04/src-1-invoice.pdf',
    original_filename: 'invoice.pdf',
    mime_type: 'application/pdf',
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

function createExtractionResultRow(
  overrides: Partial<ExtractionResultRow> = {},
): ExtractionResultRow {
  return {
    id: 'ext_job-1',
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
    id: 'inv_job-1',
    intake_job_id: 'job-1',
    source_document_id: 'src-1',
    ...overrides,
  }
}

function createInvoiceItemRow(
  overrides: Partial<InvoiceItemRow> = {},
): InvoiceItemRow {
  return {
    id: 'item-1',
    invoice_id: 'inv_job-1',
    ...overrides,
  }
}

function createLedgerRow(overrides: Partial<LedgerEntryRow> = {}): LedgerEntryRow {
  return {
    id: 'ledger-1',
    source_kind: 'manual',
    source_id: 'manual-1',
    ...overrides,
  }
}

function createProviderDraft(
  invoiceNo: string,
  totalAmount: string,
  overrides: {
    markdownText?: string
  } = {},
) {
  return {
    schemaVersion: 'invoice-extraction-v2',
    pageCount: 1,
    documentKind: 'pdf',
    header: {
      supplier: 'Bescuit Test Supplier',
      invoiceNo,
      date: '2026-05-27',
      subtotalAmount: totalAmount,
      taxAmount: '0.00',
      totalAmount,
      currency: 'EUR',
      notes: '',
    },
    lineItems: [
      {
        id: `${invoiceNo}-line-1`,
        name: 'Test item',
        qty: '1',
        unit: 'unit',
        unitPrice: totalAmount,
        lineTotal: totalAmount,
        ingredient: '',
        matched: false,
      },
    ],
    markdownText: overrides.markdownText ?? `invoice ${invoiceNo}`,
    provider: 'heuristic-v1',
    model: 'filename-fallback-v1',
    confidence: {
      overall: 0.95,
      header: 0.95,
      lineItems: 0.95,
      totals: 0.95,
    },
    warnings: [],
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
  } as unknown as R2Bucket
}
