import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

export const sourceDocuments = sqliteTable(
  'source_documents',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    documentTypeGuess: text('document_type_guess').notNull().default('invoice'),
    r2Key: text('r2_key'),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type'),
    uploadedBy: text('uploaded_by'),
    status: text('status').notNull().default('uploaded'),
    uploadedAt: text('uploaded_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('source_documents_uploaded_at_idx').on(table.uploadedAt)],
)

export const intakeJobs = sqliteTable(
  'intake_jobs',
  {
    id: text('id').primaryKey(),
    sourceDocumentId: text('source_document_id')
      .notNull()
      .references(() => sourceDocuments.id),
    extractorProvider: text('extractor_provider'),
    extractorModel: text('extractor_model'),
    stage: text('stage').notNull().default('queued'),
    confidenceScore: real('confidence_score'),
    errorMessage: text('error_message'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('intake_jobs_stage_idx').on(table.stage),
    index('intake_jobs_source_document_idx').on(table.sourceDocumentId),
  ],
)

export const extractionResults = sqliteTable(
  'extraction_results',
  {
    id: text('id').primaryKey(),
    intakeJobId: text('intake_job_id')
      .notNull()
      .references(() => intakeJobs.id),
    markdownText: text('markdown_text'),
    structuredJson: text('structured_json'),
    rawResponse: text('raw_response'),
    schemaVersion: text('schema_version'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('extraction_results_job_idx').on(table.intakeJobId)],
)

export const salesDaily = sqliteTable(
  'sales_daily',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    totalAmount: real('total_amount').notNull(),
    bbvaAmount: real('bbva_amount').notNull().default(0),
    caixaAmount: real('caixa_amount').notNull().default(0),
    cashAmount: real('cash_amount').notNull().default(0),
    status: text('status').notNull().default('draft'),
    note: text('note').notNull().default(''),
    sourceDocumentId: text('source_document_id').references(() => sourceDocuments.id),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('sales_daily_date_idx').on(table.date)],
)

export const ingredients = sqliteTable(
  'ingredients',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    category: text('category'),
    baseUnit: text('base_unit').notNull(),
    isFocus: text('is_focus').notNull().default('0'),
    priceLowerBound: real('price_lower_bound'),
    priceUpperBound: real('price_upper_bound'),
    notes: text('notes'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('ingredients_name_idx').on(table.name)],
)

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    intakeJobId: text('intake_job_id').references(() => intakeJobs.id),
    invoiceDate: text('invoice_date').notNull(),
    supplierName: text('supplier_name').notNull(),
    documentNumber: text('document_number').notNull(),
    subtotalAmount: real('subtotal_amount'),
    taxAmount: real('tax_amount').notNull().default(0),
    totalAmount: real('total_amount').notNull(),
    paymentMethod: text('payment_method'),
    currency: text('currency').notNull().default('EUR'),
    sourceDocumentId: text('source_document_id').references(() => sourceDocuments.id),
    reviewStatus: text('review_status').notNull().default('needs_review'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('invoices_invoice_date_idx').on(table.invoiceDate),
    index('invoices_review_status_idx').on(table.reviewStatus),
  ],
)

export const invoiceItems = sqliteTable(
  'invoice_items',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    rawProductName: text('raw_product_name').notNull(),
    rawQuantity: real('raw_quantity'),
    rawUnit: text('raw_unit'),
    rawUnitPrice: real('raw_unit_price'),
    rawLineTotal: real('raw_line_total'),
    ingredientId: text('ingredient_id').references(() => ingredients.id),
    normalizedQuantity: real('normalized_quantity'),
    normalizedUnit: text('normalized_unit'),
    normalizedUnitPrice: real('normalized_unit_price'),
    mappingStatus: text('mapping_status').notNull().default('unmatched'),
  },
  (table) => [
    index('invoice_items_invoice_idx').on(table.invoiceId),
    index('invoice_items_ingredient_idx').on(table.ingredientId),
  ],
)

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    entryDate: text('entry_date').notNull(),
    entryType: text('entry_type').notNull(),
    category: text('category').notNull(),
    amount: real('amount').notNull(),
    account: text('account'),
    vendor: text('vendor'),
    sourceKind: text('source_kind').notNull(),
    sourceId: text('source_id').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('ledger_entries_entry_date_idx').on(table.entryDate),
    index('ledger_entries_source_idx').on(table.sourceKind, table.sourceId),
  ],
)

export const ingredientAliases = sqliteTable(
  'ingredient_aliases',
  {
    id: text('id').primaryKey(),
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id),
    supplierName: text('supplier_name'),
    aliasName: text('alias_name').notNull(),
    specText: text('spec_text'),
    conversionRule: text('conversion_rule'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('ingredient_aliases_ingredient_idx').on(table.ingredientId),
    index('ingredient_aliases_alias_idx').on(table.aliasName),
  ],
)
