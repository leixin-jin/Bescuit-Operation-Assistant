import { describe, expect, test, vi } from 'vitest'

import type { AppBindings } from '@/lib/server/bindings'
import { hasInvoiceIntakePipelineSchema } from '@/lib/server/pipeline-readiness'

describe('invoice intake pipeline readiness', () => {
  test('stays disabled when D1 has not been migrated', async () => {
    await expect(hasInvoiceIntakePipelineSchema(createEnv({}))).resolves.toBe(false)
  })

  test('stays disabled when intake_jobs is missing error_message', async () => {
    await expect(
      hasInvoiceIntakePipelineSchema(
        createEnv({
          source_documents: ['id', 'original_filename', 'uploaded_at'],
          intake_jobs: ['id', 'source_document_id', 'stage'],
          extraction_results: ['id', 'intake_job_id', 'structured_json', 'created_at'],
        }),
      ),
    ).resolves.toBe(false)
  })

  test('enables the pipeline when required tables and columns exist', async () => {
    await expect(
      hasInvoiceIntakePipelineSchema(
        createEnv({
          source_documents: ['id', 'original_filename', 'uploaded_at'],
          intake_jobs: ['id', 'source_document_id', 'stage', 'error_message'],
          extraction_results: ['id', 'intake_job_id', 'structured_json', 'created_at'],
          invoices: [
            'id',
            'intake_job_id',
            'invoice_date',
            'supplier_name',
            'document_number',
            'total_amount',
            'review_status',
          ],
          invoice_items: ['id', 'invoice_id', 'raw_product_name', 'ingredient_id'],
          ledger_entries: ['id', 'entry_date', 'entry_type', 'category', 'amount'],
          ingredients: ['id', 'name', 'base_unit'],
        }),
      ),
    ).resolves.toBe(true)
  })
})

function createEnv(tables: Record<string, string[]>): AppBindings {
  const db = {
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(async () => {
        const tableName = sql.match(/^PRAGMA table_info\(([^)]+)\);?$/)?.[1]

        return {
          results: (tableName ? tables[tableName] : undefined)?.map((name) => ({
            name,
          })) ?? [],
          success: true,
          meta: {},
        }
      }),
    })),
  }

  return {
    DB: db as unknown as D1Database,
    RAW_DOCUMENTS: {} as R2Bucket,
    INTAKE_QUEUE: {} as Queue<unknown>,
  }
}
