CREATE TABLE account_deletion_jobs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'failed', 'completed')),
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX account_deletion_jobs_status_idx
  ON account_deletion_jobs(status, updated_at);
