CREATE TABLE concepts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('discipline_catalog', 'openalex_topic', 'user_derived')),
  source_id TEXT,
  concept_kind TEXT NOT NULL
    CHECK (concept_kind IN ('category', 'discipline', 'topic')),
  parent_concept_id TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  category_code TEXT,
  category_name TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source, source_id)
);

CREATE INDEX concepts_source_idx ON concepts(source);
CREATE INDEX concepts_parent_idx ON concepts(parent_concept_id);
CREATE INDEX concepts_category_code_idx ON concepts(category_code);
