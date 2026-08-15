CREATE TABLE IF NOT EXISTS scan_results (
  scan_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_results_updated_at
  ON scan_results(updated_at);
