CREATE TABLE external_pdf_grants (
  grant_id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX external_pdf_grants_owner_idx
  ON external_pdf_grants(owner_key, source_id, expires_at);

CREATE INDEX external_pdf_grants_expiry_idx
  ON external_pdf_grants(expires_at);
