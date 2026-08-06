-- Faz 4: doğrulanmış stok geçişleri ve fiyat baz çizgileri
ALTER TABLE products ADD COLUMN stock_status TEXT NOT NULL DEFAULT 'unknown';

UPDATE products
SET stock_status = CASE
  WHEN in_stock = 1 THEN 'in_stock'
  WHEN in_stock = 0 THEN 'out_of_stock'
  ELSE 'unknown'
END;

CREATE TABLE IF NOT EXISTS product_stock_state (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  confirmed_status TEXT NOT NULL DEFAULT 'unknown',
  candidate_status TEXT,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  unknown_streak INTEGER NOT NULL DEFAULT 0,
  parser_error INTEGER NOT NULL DEFAULT 0,
  last_observed_at INTEGER,
  last_transition_at INTEGER
);

INSERT OR IGNORE INTO product_stock_state (product_id, confirmed_status)
SELECT id, stock_status FROM products;

CREATE TABLE IF NOT EXISTS stock_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 2,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_transitions_product
  ON stock_transitions(product_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS price_baselines (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  median_10d REAL,
  low_10d REAL,
  median_30d REAL,
  median_90d REAL,
  all_time_low REAL,
  sample_count_10d INTEGER NOT NULL DEFAULT 0,
  sample_count_30d INTEGER NOT NULL DEFAULT 0,
  sample_count_90d INTEGER NOT NULL DEFAULT 0,
  sample_count_all INTEGER NOT NULL DEFAULT 0,
  calculated_at INTEGER NOT NULL
);
