-- Faz 3: domain bazlı dağıtık hız sınırı ve adaptif geri çekilme (Postgres)
CREATE TABLE IF NOT EXISTS crawl_domain_state (
  domain TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crawl_domain_due ON crawl_domain_state(next_allowed_at);
