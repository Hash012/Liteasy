-- Replies are interaction records. A reply with literature targets also owns one
-- independent annotation; the association survives deletion of the parent.

DROP INDEX community_profile_institutions_filter_idx;
DELETE FROM community_profile_institutions current
USING community_profile_institutions duplicate
WHERE current.user_id = duplicate.user_id
  AND current.institution_name = duplicate.institution_name
  AND (current.position > duplicate.position OR
    (current.position = duplicate.position AND current.ctid > duplicate.ctid));
ALTER TABLE community_profile_institutions DROP CONSTRAINT community_profile_institutions_pkey;
ALTER TABLE community_profile_institutions DROP COLUMN institution_type;
ALTER TABLE community_profile_institutions
  ADD PRIMARY KEY (user_id, institution_name);
CREATE INDEX community_profile_institutions_filter_idx
  ON community_profile_institutions(institution_name, user_id);

CREATE TABLE annotation_replies (
  id text PRIMARY KEY,
  parent_annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE RESTRICT,
  derived_annotation_id text UNIQUE REFERENCES annotations(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  author_id text NOT NULL CHECK (length(author_id) BETWEEN 1 AND 200),
  author_name text NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 200),
  author_initials text NOT NULL CHECK (length(author_initials) BETWEEN 1 AND 8),
  author_profile_snapshot jsonb NOT NULL CHECK (jsonb_typeof(author_profile_snapshot) = 'object'),
  visibility text NOT NULL CHECK (visibility IN ('private', 'organization', 'mutual_followers', 'public')),
  organization_id text CHECK (organization_id IS NULL OR length(organization_id) BETWEEN 1 AND 200),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  parent_deleted_at timestamptz,
  CHECK (
    (visibility = 'organization' AND organization_id IS NOT NULL) OR
    (visibility <> 'organization' AND organization_id IS NULL)
  )
);
CREATE INDEX annotation_replies_parent_idx
  ON annotation_replies(parent_annotation_id, created_at, id)
  WHERE deleted_at IS NULL;
CREATE INDEX annotation_replies_author_idx
  ON annotation_replies(author_id, updated_at DESC, id);

ALTER TABLE annotations ADD COLUMN source_reply_id text REFERENCES annotation_replies(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX annotations_source_reply_idx
  ON annotations(source_reply_id) WHERE source_reply_id IS NOT NULL;

CREATE TABLE annotation_ratings (
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, user_id)
);
CREATE INDEX annotation_ratings_annotation_idx ON annotation_ratings(annotation_id, rating);

CREATE TABLE annotation_versions (
  id text PRIMARY KEY,
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  body text NOT NULL,
  author_profile_snapshot jsonb NOT NULL,
  visibility text NOT NULL,
  organization_id text,
  share_to_plaza boolean NOT NULL,
  targets jsonb NOT NULL CHECK (jsonb_typeof(targets) = 'array'),
  tags jsonb NOT NULL CHECK (jsonb_typeof(tags) = 'array'),
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (annotation_id, revision)
);

CREATE TABLE annotation_reply_versions (
  id text PRIMARY KEY,
  reply_id text NOT NULL REFERENCES annotation_replies(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  body text NOT NULL,
  author_profile_snapshot jsonb NOT NULL,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reply_id, revision)
);

CREATE TRIGGER annotation_versions_append_only
BEFORE UPDATE OR DELETE ON annotation_versions
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();

CREATE TRIGGER annotation_reply_versions_append_only
BEFORE UPDATE OR DELETE ON annotation_reply_versions
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
