-- Faz 7: kullanici bildirim kanallari, gunluk firsat akisi ve ic uyum araci (SQLite)

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  web_push_enabled INTEGER NOT NULL DEFAULT 0,
  delivery_mode TEXT NOT NULL DEFAULT 'instant',
  unsubscribe_token TEXT NOT NULL UNIQUE,
  unsubscribed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  content_encoding TEXT NOT NULL DEFAULT 'aes128gcm',
  active INTEGER NOT NULL DEFAULT 1,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_success_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id, active);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  delivery_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON notification_deliveries(status, next_attempt_at, channel);

-- Materialized-view yerine iki DB motorunda da ayni davranan gunluk snapshot tablosu.
CREATE TABLE IF NOT EXISTS opportunity_feed (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  current_price REAL NOT NULL,
  reference_price REAL NOT NULL,
  reference_kind TEXT NOT NULL,
  drop_pct REAL NOT NULL,
  at_all_time_low INTEGER NOT NULL DEFAULT 0,
  stock_status TEXT NOT NULL,
  score REAL NOT NULL,
  calculated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opportunity_feed_score ON opportunity_feed(score DESC, calculated_at DESC);

CREATE TABLE IF NOT EXISTS compliance_assessments (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  advertised_reference REAL,
  observed_price REAL,
  low_10d_before REAL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  evidence_start_at INTEGER,
  evidence_end_at INTEGER,
  reason TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  rule_effective_at INTEGER NOT NULL,
  calculated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compliance_assessments_status
  ON compliance_assessments(status, calculated_at DESC);
