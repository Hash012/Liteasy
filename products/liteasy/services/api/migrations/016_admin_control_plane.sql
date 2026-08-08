CREATE TABLE platform_model_policies (
  policy_id text PRIMARY KEY CHECK (policy_id = 'active'),
  cloud_proxy_endpoint text NOT NULL,
  default_provider text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_retrieval_sources (
  source_id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  source_kind text NOT NULL CHECK (source_kind IN ('website', 'database')),
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL CHECK (revision > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX platform_retrieval_sources_name_unique
  ON platform_retrieval_sources(lower(name));

