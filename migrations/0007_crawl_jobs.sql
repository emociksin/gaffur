-- Faz 3: kalıcı tarama kuyruğu (SQLite)
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'listing')),
  entity_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at INTEGER,
  locked_by TEXT,
  last_error TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_due ON crawl_jobs(status, run_after, priority DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_jobs_active_entity
  ON crawl_jobs(kind, entity_id) WHERE status IN ('queued', 'running');
