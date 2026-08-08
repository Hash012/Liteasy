-- M4: 把 personalization_terms 收敛为「用户 tag 权重」，关联规范化 tags 并记录证据数与来源。
ALTER TABLE personalization_terms ADD COLUMN tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE personalization_terms ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1
  CHECK (evidence_count >= 0);
ALTER TABLE personalization_terms ADD COLUMN signal_source TEXT;

CREATE INDEX IF NOT EXISTS personalization_terms_tag_idx ON personalization_terms(tag_id);
CREATE INDEX IF NOT EXISTS personalization_terms_owner_evidence_idx
  ON personalization_terms(owner_key, weight DESC, evidence_count DESC, updated_at DESC);
