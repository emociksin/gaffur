-- Faz 2: offer/user/session/watches tabloları (SQLite)
-- Mevcut products tablosu korunur; offers yan tablo olarak eklenir.

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL,
  seller_name TEXT,
  seller_id TEXT,
  url TEXT NOT NULL,
  canonical_offer_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  parser_version TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_offers_canonical ON offers(canonical_offer_key);

CREATE TABLE IF NOT EXISTS offer_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  list_price REAL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  stock_status TEXT NOT NULL DEFAULT 'unknown',
  shipping_cost REAL,
  free_shipping_threshold REAL,
  installment_count INTEGER,
  engine TEXT,
  parser_version TEXT,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_offer ON offer_snapshots(offer_id, checked_at);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  email_verified INTEGER NOT NULL DEFAULT 0,
  kvkk_consent INTEGER NOT NULL DEFAULT 0,
  kvkk_consent_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_price REAL,
  alert_mode TEXT NOT NULL DEFAULT 'drop',
  threshold_pct REAL NOT NULL DEFAULT 0,
  notify_channels TEXT NOT NULL DEFAULT 'telegram',
  marketplace_filter TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watches_user ON watches(user_id);
CREATE INDEX IF NOT EXISTS idx_watches_product ON watches(product_id);
