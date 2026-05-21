ALTER TABLE source_documents ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS source_documents_content_hash_unique_idx
  ON source_documents(content_hash);

ALTER TABLE invoices ADD COLUMN dedupe_key TEXT;

UPDATE invoices
SET dedupe_key =
  lower(trim(supplier_name)) || '|' || trim(document_number) || '|' || invoice_date
WHERE dedupe_key IS NULL
  AND supplier_name IS NOT NULL
  AND document_number IS NOT NULL
  AND invoice_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_dedupe_key_unique_idx
  ON invoices(dedupe_key);
