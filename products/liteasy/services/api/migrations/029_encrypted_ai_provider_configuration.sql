CREATE TABLE platform_ai_provider_configuration (
  configuration_id text PRIMARY KEY CHECK (configuration_id = 'active'),
  algorithm text NOT NULL CHECK (algorithm = 'aes-256-gcm-v1'),
  initialization_vector bytea NOT NULL CHECK (octet_length(initialization_vector) = 12),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  encrypted_payload bytea NOT NULL CHECK (octet_length(encrypted_payload) > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
