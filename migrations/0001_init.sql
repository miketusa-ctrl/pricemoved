CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  google_sub TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  polar_customer_id TEXT,
  slack_webhook_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  css_selector TEXT,
  interval TEXT NOT NULL DEFAULT 'daily',
  muted INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_changed_at TEXT,
  last_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES watches(id),
  hash TEXT NOT NULL,
  text_body TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES watches(id),
  prev_hash TEXT,
  new_hash TEXT NOT NULL,
  diff_text TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  polar_subscription_id TEXT,
  product_id TEXT,
  status TEXT,
  current_period_end TEXT
);

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  source TEXT
);

CREATE TABLE IF NOT EXISTS dry_run_artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watches_due ON watches(muted, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_watch ON snapshots(watch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_changes_watch ON changes(watch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dry_run_kind ON dry_run_artifacts(kind, created_at);

CREATE TABLE IF NOT EXISTS waitlist_rate (
  ip_hash TEXT NOT NULL,
  window_id TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ip_hash, window_id)
);
CREATE INDEX IF NOT EXISTS idx_waitlist_rate_updated ON waitlist_rate(updated_at);
