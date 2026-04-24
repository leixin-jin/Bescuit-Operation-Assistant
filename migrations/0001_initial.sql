CREATE TABLE `source_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `document_type_guess` text NOT NULL DEFAULT 'invoice',
  `r2_key` text,
  `original_filename` text NOT NULL,
  `mime_type` text,
  `uploaded_by` text,
  `status` text NOT NULL DEFAULT 'uploaded',
  `uploaded_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX `source_documents_uploaded_at_idx`
  ON `source_documents` (`uploaded_at`);

CREATE TABLE `intake_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_document_id` text NOT NULL,
  `extractor_provider` text,
  `extractor_model` text,
  `stage` text NOT NULL DEFAULT 'queued',
  `confidence_score` real,
  `error_message` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`)
);

CREATE INDEX `intake_jobs_stage_idx`
  ON `intake_jobs` (`stage`);

CREATE INDEX `intake_jobs_source_document_idx`
  ON `intake_jobs` (`source_document_id`);

CREATE TABLE `extraction_results` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_job_id` text NOT NULL,
  `markdown_text` text,
  `structured_json` text,
  `raw_response` text,
  `schema_version` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`intake_job_id`) REFERENCES `intake_jobs`(`id`)
);

CREATE INDEX `extraction_results_job_idx`
  ON `extraction_results` (`intake_job_id`);

CREATE TABLE `sales_daily` (
  `id` text PRIMARY KEY NOT NULL,
  `date` text NOT NULL,
  `total_amount` real NOT NULL,
  `bbva_amount` real NOT NULL DEFAULT 0,
  `caixa_amount` real NOT NULL DEFAULT 0,
  `cash_amount` real NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'draft',
  `note` text NOT NULL DEFAULT '',
  `source_document_id` text,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`)
);

CREATE INDEX `sales_daily_date_idx`
  ON `sales_daily` (`date`);

CREATE TABLE `ingredients` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `category` text,
  `base_unit` text NOT NULL,
  `is_focus` text NOT NULL DEFAULT '0',
  `price_lower_bound` real,
  `price_upper_bound` real,
  `notes` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX `ingredients_name_idx`
  ON `ingredients` (`name`);

CREATE TABLE `invoices` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_job_id` text,
  `invoice_date` text NOT NULL,
  `supplier_name` text NOT NULL,
  `document_number` text NOT NULL,
  `subtotal_amount` real,
  `tax_amount` real NOT NULL DEFAULT 0,
  `total_amount` real NOT NULL,
  `payment_method` text,
  `currency` text NOT NULL DEFAULT 'EUR',
  `source_document_id` text,
  `review_status` text NOT NULL DEFAULT 'needs_review',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`intake_job_id`) REFERENCES `intake_jobs`(`id`),
  FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`)
);

CREATE INDEX `invoices_invoice_date_idx`
  ON `invoices` (`invoice_date`);

CREATE INDEX `invoices_review_status_idx`
  ON `invoices` (`review_status`);

CREATE TABLE `invoice_items` (
  `id` text PRIMARY KEY NOT NULL,
  `invoice_id` text NOT NULL,
  `raw_product_name` text NOT NULL,
  `raw_quantity` real,
  `raw_unit` text,
  `raw_unit_price` real,
  `raw_line_total` real,
  `ingredient_id` text,
  `normalized_quantity` real,
  `normalized_unit` text,
  `normalized_unit_price` real,
  `mapping_status` text NOT NULL DEFAULT 'unmatched',
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`),
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`)
);

CREATE INDEX `invoice_items_invoice_idx`
  ON `invoice_items` (`invoice_id`);

CREATE INDEX `invoice_items_ingredient_idx`
  ON `invoice_items` (`ingredient_id`);

CREATE TABLE `ledger_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `entry_date` text NOT NULL,
  `entry_type` text NOT NULL,
  `category` text NOT NULL,
  `amount` real NOT NULL,
  `account` text,
  `vendor` text,
  `source_kind` text NOT NULL,
  `source_id` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX `ledger_entries_entry_date_idx`
  ON `ledger_entries` (`entry_date`);

CREATE INDEX `ledger_entries_source_idx`
  ON `ledger_entries` (`source_kind`, `source_id`);

CREATE TABLE `ingredient_aliases` (
  `id` text PRIMARY KEY NOT NULL,
  `ingredient_id` text NOT NULL,
  `supplier_name` text,
  `alias_name` text NOT NULL,
  `spec_text` text,
  `conversion_rule` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`)
);

CREATE INDEX `ingredient_aliases_ingredient_idx`
  ON `ingredient_aliases` (`ingredient_id`);

CREATE INDEX `ingredient_aliases_alias_idx`
  ON `ingredient_aliases` (`alias_name`);
