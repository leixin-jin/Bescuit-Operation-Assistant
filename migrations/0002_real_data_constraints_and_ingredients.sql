CREATE UNIQUE INDEX IF NOT EXISTS `sales_daily_date_unique_idx`
  ON `sales_daily` (`date`);

CREATE UNIQUE INDEX IF NOT EXISTS `invoices_intake_job_unique_idx`
  ON `invoices` (`intake_job_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `ledger_entries_source_unique_idx`
  ON `ledger_entries` (`source_kind`, `source_id`);

INSERT OR IGNORE INTO `ingredients` (
  `id`,
  `name`,
  `category`,
  `base_unit`,
  `is_focus`,
  `notes`
) VALUES
  ('heineken-330', 'Heineken 啤酒 330ml', 'beer', 'bottle', '1', 'Initial ingredient seed'),
  ('absolut-750', 'Absolut Vodka 750ml', 'spirits', 'bottle', '1', 'Initial ingredient seed'),
  ('coke-330', '可口可乐 330ml', 'soft_drink', 'can', '1', 'Initial ingredient seed'),
  ('lemon', '柠檬', 'produce', 'kg', '0', 'Initial ingredient seed'),
  ('mint', '薄荷叶', 'produce', 'box', '0', 'Initial ingredient seed'),
  ('lime', '青柠', 'produce', 'kg', '0', 'Initial ingredient seed');
