CREATE TABLE IF NOT EXISTS parser_health (
  site TEXT NOT NULL, parser_version TEXT NOT NULL, bucket_at INTEGER NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
  alarm_sent INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY (site, parser_version, bucket_at)
);
CREATE INDEX IF NOT EXISTS idx_parser_health_recent ON parser_health(bucket_at, failure_count);
