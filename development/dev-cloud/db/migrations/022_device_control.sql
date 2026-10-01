CREATE TABLE device_control_accounts (
  subject_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
