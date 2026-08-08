ALTER TABLE storage_quotas
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  ADD COLUMN updated_by text NOT NULL DEFAULT 'migration';

ALTER TABLE storage_quotas
  ALTER COLUMN updated_by DROP DEFAULT;

