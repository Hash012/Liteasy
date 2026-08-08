CREATE TABLE desktop_draft_handoffs (
  id text PRIMARY KEY,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object'),
  draft_update jsonb CHECK (draft_update IS NULL OR jsonb_typeof(draft_update) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  draft_id text UNIQUE REFERENCES drafts(id) ON DELETE SET NULL,
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL AND draft_id IS NULL) OR (consumed_at IS NOT NULL AND draft_id IS NOT NULL))
);
CREATE INDEX desktop_draft_handoffs_owner_expiry_idx
  ON desktop_draft_handoffs(owner_id, expires_at DESC);

CREATE TABLE community_annotations (
  id text PRIMARY KEY,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  source_annotation_id text NOT NULL CHECK (length(source_annotation_id) BETWEEN 1 AND 200),
  queue_key text NOT NULL CHECK (length(queue_key) BETWEEN 1 AND 500),
  paper_identity_kind text NOT NULL CHECK (
    paper_identity_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'title_authors_year_hash')
  ),
  paper_identity_value text NOT NULL CHECK (length(paper_identity_value) BETWEEN 1 AND 1000),
  scope_kind text NOT NULL CHECK (
    scope_kind IN ('pdf_passage', 'document', 'section', 'selected_passage')
  ),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  excerpt text NOT NULL CHECK (length(btrim(excerpt)) BETWEEN 1 AND 2000),
  source_created_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, queue_key),
  CHECK (source_updated_at >= source_created_at)
);
CREATE INDEX community_annotations_paper_updated_idx
  ON community_annotations(paper_identity_kind, paper_identity_value, updated_at DESC, id);
