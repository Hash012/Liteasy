ALTER TABLE visualization_provider_configs
  DROP CONSTRAINT visualization_provider_configs_timeout_ms_check;

ALTER TABLE visualization_provider_configs
  ADD CONSTRAINT visualization_provider_configs_timeout_ms_check
  CHECK (timeout_ms BETWEEN 100 AND 600000);
