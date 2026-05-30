ALTER TABLE invoice_items
ADD COLUMN valid_price integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS invoice_items_valid_ingredient_price_idx
  ON invoice_items (valid_price, ingredient_id, raw_unit_price);

CREATE INDEX IF NOT EXISTS invoice_items_valid_raw_name_price_idx
  ON invoice_items (valid_price, raw_product_name, raw_unit_price);
