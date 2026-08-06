-- Faz 9: kaynakli Google Trends teknoloji talep katalogu (Postgres)

CREATE TABLE IF NOT EXISTS trend_catalog_items (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  catalog_kind TEXT NOT NULL,
  anchor_term TEXT NOT NULL,
  anchor_rank INTEGER,
  anchor_interest INTEGER,
  signal_type TEXT NOT NULL,
  signal_rank INTEGER NOT NULL,
  interest_value INTEGER,
  growth_label TEXT,
  geo TEXT NOT NULL DEFAULT 'TR',
  timeframe TEXT NOT NULL,
  category_label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  query_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  matched_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  captured_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(anchor_term, query, signal_type),
  CHECK(catalog_kind IN ('product_family', 'category', 'brand', 'accessory')),
  CHECK(signal_type IN ('top', 'rising')),
  CHECK(status IN ('published', 'hidden'))
);

CREATE INDEX IF NOT EXISTS idx_trend_catalog_public
  ON trend_catalog_items(status, anchor_term, signal_type, signal_rank);
CREATE INDEX IF NOT EXISTS idx_trend_catalog_match
  ON trend_catalog_items(matched_product_id);
