-- Faz 8: katalog kimligi, eslestirme adaylari ve insan onayli kanonik gruplar (Postgres)

CREATE TABLE IF NOT EXISTS product_identities (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  normalized_title TEXT NOT NULL,
  normalized_brand TEXT,
  model_key TEXT,
  variant_key TEXT,
  gtin_normalized TEXT,
  gtin_valid INTEGER NOT NULL DEFAULT 0,
  mpn_normalized TEXT,
  mpn_reliable INTEGER NOT NULL DEFAULT 0,
  identity_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_identities_gtin
  ON product_identities(gtin_normalized, gtin_valid);
CREATE INDEX IF NOT EXISTS idx_product_identities_mpn
  ON product_identities(normalized_brand, mpn_normalized, mpn_reliable);

CREATE TABLE IF NOT EXISTS product_match_candidates (
  id SERIAL PRIMARY KEY,
  product_a_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_b_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score DOUBLE PRECISION NOT NULL,
  score_band TEXT NOT NULL,
  score_version TEXT NOT NULL,
  exact_code_kind TEXT,
  title_score DOUBLE PRECISION NOT NULL,
  model_score DOUBLE PRECISION NOT NULL,
  price_score DOUBLE PRECISION NOT NULL,
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(product_a_id, product_b_id),
  CHECK(product_a_id < product_b_id)
);
CREATE INDEX IF NOT EXISTS idx_match_candidates_queue
  ON product_match_candidates(status, score DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog_products (
  id SERIAL PRIMARY KEY,
  representative_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  display_title TEXT NOT NULL,
  brand TEXT,
  gtin TEXT,
  mpn TEXT,
  variant_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_memberships (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  catalog_product_id INTEGER NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  match_candidate_id INTEGER REFERENCES product_match_candidates(id) ON DELETE SET NULL,
  confidence DOUBLE PRECISION NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_memberships_catalog
  ON catalog_memberships(catalog_product_id);
