import {
  hasInvoiceIntakePipelineBindings,
  type AppBindings,
} from '@/lib/server/bindings'

const requiredInvoicePipelineColumns = {
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
} as const satisfies Record<string, readonly string[]>

export async function hasInvoiceIntakePipelineSchema(
  env?: Partial<AppBindings> | null,
) {
  if (!hasInvoiceIntakePipelineBindings(env)) {
    return false
  }

  try {
    for (const [tableName, requiredColumns] of Object.entries(
      requiredInvoicePipelineColumns,
    )) {
      const existingColumns = await getD1TableColumns(env.DB, tableName)

      if (!requiredColumns.every((columnName) => existingColumns.has(columnName))) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

async function getD1TableColumns(db: D1Database, tableName: string) {
  const result = await db
    .prepare(`PRAGMA table_info(${tableName});`)
    .all<{ name: string | null }>()

  return new Set(
    (result.results ?? [])
      .map((row) => row.name)
      .filter((columnName): columnName is string => Boolean(columnName)),
  )
}
