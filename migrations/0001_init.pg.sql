-- Gaffur Postgres semasi (SQLite 0001-0004 birlesimi)

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#E4611C',
  source_url TEXT,
  site TEXT,
  auto_track INTEGER NOT NULL DEFAULT 0,
  last_discovered_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  title TEXT NOT NULL,
  image TEXT,
  currency TEXT NOT NULL DEFAULT 'TRY',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  target_price DOUBLE PRECISION,
  alert_mode TEXT NOT NULL DEFAULT 'drop',
  threshold_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  interval_min INTEGER NOT NULL DEFAULT 60,
  engine TEXT NOT NULL DEFAULT 'auto',
  active INTEGER NOT NULL DEFAULT 1,
  current_price DOUBLE PRECISION,
  previous_price DOUBLE PRECISION,
  list_price DOUBLE PRECISION,
  in_stock INTEGER,
  min_price DOUBLE PRECISION,
  max_price DOUBLE PRECISION,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_engine TEXT,
  last_checked_at INTEGER,
  last_change_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price DOUBLE PRECISION NOT NULL,
  list_price DOUBLE PRECISION,
  in_stock INTEGER,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_product ON price_history(product_id, checked_at);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  old_price DOUBLE PRECISION,
  new_price DOUBLE PRECISION,
  read INTEGER NOT NULL DEFAULT 0,
  sent_telegram INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
