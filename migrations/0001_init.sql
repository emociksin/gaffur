-- Gaffur ilk sema
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#FFB020',
  source_url TEXT,
  site TEXT,
  auto_track INTEGER NOT NULL DEFAULT 0,
  last_discovered_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  title TEXT NOT NULL,
  image TEXT,
  currency TEXT NOT NULL DEFAULT 'TRY',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  target_price REAL,
  alert_mode TEXT NOT NULL DEFAULT 'drop',      -- drop | target | any | off
  threshold_pct REAL NOT NULL DEFAULT 0,        -- bildirim icin asgari % dusus (0 = her dusus)
  interval_min INTEGER NOT NULL DEFAULT 60,
  engine TEXT NOT NULL DEFAULT 'auto',          -- auto | direct | firecrawl
  active INTEGER NOT NULL DEFAULT 1,
  current_price REAL,
  previous_price REAL,
  list_price REAL,
  in_stock INTEGER,
  min_price REAL,
  max_price REAL,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  list_price REAL,
  in_stock INTEGER,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_product ON price_history(product_id, checked_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- drop | rise | target | stock | new_product | error
  title TEXT NOT NULL,
  body TEXT,
  old_price REAL,
  new_price REAL,
  read INTEGER NOT NULL DEFAULT 0,
  sent_telegram INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
