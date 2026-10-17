-- Agent-ready v0.2.0: privacy-friendly daily unique visitors. h = first 16 hex of SHA-256(VISITOR_SALT|UTC day|IP bucket).
-- No IP, user agent, path or content is stored. Rows older than 9 days are deleted by the cron (pruneVisitors).
-- The Worker also creates this table lazily (CREATE TABLE IF NOT EXISTS), so this migration is optional but recommended.
CREATE TABLE IF NOT EXISTS visitor_daily (
  day TEXT NOT NULL,
  h TEXT NOT NULL,
  PRIMARY KEY (day, h)
);
