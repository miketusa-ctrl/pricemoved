-- Waitlist abuse protection (hashed IP only; no raw IP stored)
CREATE TABLE IF NOT EXISTS waitlist_rate (
  ip_hash TEXT NOT NULL,
  window_id TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ip_hash, window_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_rate_updated ON waitlist_rate(updated_at);
