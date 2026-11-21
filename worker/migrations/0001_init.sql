-- A2Z Order Pad cloud storage (Cloudflare D1)
-- One row per app record. seq increases with every write so phones can download only changes.
CREATE TABLE IF NOT EXISTS records (
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,                      -- JSON (NULL when deleted)
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,            -- when the change was made on the phone (ms)
  device TEXT,
  PRIMARY KEY (tbl, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (seq);

-- k = 'seq' (counter), 'keyhash' (SHA-256 of the access key), 'claimedAt'
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', '0');

-- audit trail of scheduled report runs
CREATE TABLE IF NOT EXISTS cron_runs (
  at INTEGER NOT NULL,
  created TEXT NOT NULL
);
