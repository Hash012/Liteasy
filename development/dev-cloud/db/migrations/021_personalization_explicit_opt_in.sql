CREATE TABLE personalization_settings_explicit_opt_in (
  owner_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

INSERT INTO personalization_settings_explicit_opt_in (owner_key, enabled, updated_at)
SELECT owner_key, enabled, updated_at
FROM personalization_settings;

DROP TABLE personalization_settings;

ALTER TABLE personalization_settings_explicit_opt_in
  RENAME TO personalization_settings;
