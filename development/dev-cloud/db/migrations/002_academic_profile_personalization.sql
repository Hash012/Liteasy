CREATE TABLE academic_profiles (
  owner_key TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT '未设置',
  disciplines_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(disciplines_json)),
  profile_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE personalization_states (
  owner_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE personalization_terms (
  owner_key TEXT NOT NULL,
  term TEXT NOT NULL,
  weight REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, term)
);

CREATE INDEX personalization_terms_owner_weight
  ON personalization_terms(owner_key, weight DESC, updated_at DESC);

CREATE TABLE recommendation_suppressions (
  owner_key TEXT NOT NULL,
  recommendation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, recommendation_id)
);
