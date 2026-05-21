ALTER TABLE source_documents ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS source_documents_content_hash_unique_idx
  ON source_documents(content_hash);

ALTER TABLE invoices ADD COLUMN dedupe_key TEXT;

WITH ranked_invoice_dedupe_keys AS (
  SELECT
    id,
    canonical_key,
    ROW_NUMBER() OVER (
      PARTITION BY canonical_key
      ORDER BY created_at ASC, id ASC
    ) AS dedupe_rank
  FROM (
    SELECT
      id,
      created_at,
      lower(trim(supplier_name)) || '|' || trim(document_number) || '|' || invoice_date AS canonical_key
    FROM invoices
    WHERE dedupe_key IS NULL
      AND supplier_name IS NOT NULL
      AND document_number IS NOT NULL
      AND invoice_date IS NOT NULL
  )
)
UPDATE invoices
SET dedupe_key = (
  SELECT
    CASE
      WHEN dedupe_rank = 1 THEN canonical_key
      ELSE canonical_key || '|legacy-duplicate|' || ranked_invoice_dedupe_keys.id
    END
  FROM ranked_invoice_dedupe_keys
  WHERE ranked_invoice_dedupe_keys.id = invoices.id
)
WHERE id IN (
  SELECT id
  FROM ranked_invoice_dedupe_keys
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_dedupe_key_unique_idx
  ON invoices(dedupe_key);
