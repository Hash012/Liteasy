CREATE TABLE literature_records (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 1000),
  authors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(authors) = 'array'),
  publication_year integer CHECK (publication_year IS NULL OR publication_year BETWEEN 1000 AND 9999),
  document_type text CHECK (document_type IS NULL OR length(btrim(document_type)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE desktop_annotation_handoffs (
  id text PRIMARY KEY,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX desktop_annotation_handoffs_owner_expiry_idx
  ON desktop_annotation_handoffs(owner_id, expires_at DESC);

CREATE TABLE literature_identities (
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  identity_kind text NOT NULL CHECK (
    identity_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'title_authors_year_hash')
  ),
  identity_value text NOT NULL CHECK (length(btrim(identity_value)) BETWEEN 1 AND 1000),
  identity_source text NOT NULL CHECK (identity_source IN ('inferred', 'metadata')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (literature_id, identity_kind, identity_value),
  UNIQUE (identity_kind, identity_value)
);

CREATE TABLE community_user_profiles (
  user_id text PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 200),
  education_stage text CHECK (education_stage IS NULL OR length(btrim(education_stage)) BETWEEN 1 AND 100),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_profile_institutions (
  user_id text NOT NULL REFERENCES community_user_profiles(user_id) ON DELETE CASCADE,
  institution_name text NOT NULL CHECK (length(btrim(institution_name)) BETWEEN 1 AND 300),
  institution_type text NOT NULL CHECK (length(btrim(institution_type)) BETWEEN 1 AND 100),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 19),
  PRIMARY KEY (user_id, institution_name, institution_type)
);
CREATE INDEX community_profile_institutions_filter_idx
  ON community_profile_institutions(institution_name, institution_type, user_id);

CREATE TABLE annotations (
  id text PRIMARY KEY,
  parent_annotation_id text REFERENCES annotations(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  author_id text NOT NULL CHECK (length(author_id) BETWEEN 1 AND 200),
  author_name text NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 200),
  author_initials text NOT NULL CHECK (length(author_initials) BETWEEN 1 AND 8),
  author_profile_snapshot jsonb NOT NULL CHECK (jsonb_typeof(author_profile_snapshot) = 'object'),
  visibility text NOT NULL CHECK (
    visibility IN ('private', 'organization', 'mutual_followers', 'public')
  ),
  organization_id text CHECK (organization_id IS NULL OR length(organization_id) BETWEEN 1 AND 200),
  share_to_plaza boolean NOT NULL DEFAULT true,
  helpful bigint NOT NULL DEFAULT 0 CHECK (helpful >= 0),
  misleading bigint NOT NULL DEFAULT 0 CHECK (misleading >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  CHECK (parent_annotation_id IS NULL OR parent_annotation_id <> id),
  CHECK (NOT share_to_plaza OR visibility = 'public'),
  CHECK (
    (visibility = 'organization' AND organization_id IS NOT NULL) OR
    (visibility <> 'organization' AND organization_id IS NULL)
  )
);
CREATE INDEX annotations_plaza_idx ON annotations(created_at DESC, id)
  WHERE share_to_plaza AND withdrawn_at IS NULL;
CREATE INDEX annotations_author_idx ON annotations(author_id, updated_at DESC, id);
CREATE INDEX annotations_parent_idx ON annotations(parent_annotation_id, created_at, id)
  WHERE parent_annotation_id IS NOT NULL;
CREATE INDEX annotations_organization_idx ON annotations(organization_id, created_at DESC, id)
  WHERE organization_id IS NOT NULL AND withdrawn_at IS NULL;

CREATE FUNCTION validate_annotation_parent_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent annotations;
BEGIN
  IF NEW.parent_annotation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO parent FROM annotations WHERE id = NEW.parent_annotation_id;
  IF parent.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'parent_annotation_not_found';
  END IF;
  IF parent.visibility <> NEW.visibility OR parent.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'reply_visibility_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER annotations_parent_scope_guard
BEFORE INSERT OR UPDATE OF parent_annotation_id, visibility, organization_id ON annotations
FOR EACH ROW EXECUTE FUNCTION validate_annotation_parent_scope();

CREATE TABLE annotation_targets (
  id text PRIMARY KEY,
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE RESTRICT,
  target_kind text NOT NULL CHECK (
    target_kind IN ('whole_document', 'source_passage', 'derived_passage')
  ),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    target_kind <> 'derived_passage' OR
    (jsonb_typeof(target -> 'evidence') = 'array' AND jsonb_array_length(target -> 'evidence') > 0)
  )
);

CREATE TABLE desktop_annotation_syncs (
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  queue_key text NOT NULL CHECK (length(queue_key) BETWEEN 1 AND 500),
  source_annotation_id text NOT NULL CHECK (length(source_annotation_id) BETWEEN 1 AND 200),
  annotation_id text NOT NULL UNIQUE REFERENCES annotations(id) ON DELETE CASCADE,
  source_created_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, queue_key),
  CHECK (source_updated_at >= source_created_at)
);
CREATE INDEX annotation_targets_annotation_idx ON annotation_targets(annotation_id, id);
CREATE UNIQUE INDEX annotation_targets_position_idx ON annotation_targets(annotation_id, position);
CREATE INDEX annotation_targets_literature_idx ON annotation_targets(literature_id, annotation_id);

CREATE TABLE annotation_target_evidence (
  target_id text NOT NULL REFERENCES annotation_targets(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE RESTRICT,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  PRIMARY KEY (target_id, position)
);
CREATE INDEX annotation_target_evidence_literature_idx
  ON annotation_target_evidence(literature_id, target_id);

CREATE FUNCTION validate_annotation_has_target() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate annotations;
  candidate_id text;
BEGIN
  IF TG_TABLE_NAME = 'annotations' THEN
    candidate_id := NEW.id;
  ELSE
    candidate_id := OLD.annotation_id;
  END IF;
  SELECT * INTO candidate FROM annotations WHERE id = candidate_id;
  IF candidate.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF (candidate.parent_annotation_id IS NULL OR candidate.share_to_plaza) AND NOT EXISTS (
    SELECT 1 FROM annotation_targets WHERE annotation_id = candidate.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'annotation_target_required';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER annotations_require_target
AFTER INSERT OR UPDATE OF parent_annotation_id, share_to_plaza ON annotations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_annotation_has_target();

CREATE CONSTRAINT TRIGGER annotation_targets_preserve_requirement
AFTER DELETE ON annotation_targets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_annotation_has_target();

CREATE TABLE annotation_tags (
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('user', 'platform')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'appealed', 'upheld', 'removed')),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  classifier_version text CHECK (classifier_version IS NULL OR length(classifier_version) BETWEEN 1 AND 200),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, tag_id, origin)
);
CREATE INDEX annotation_tags_tag_idx ON annotation_tags(tag_id, state, annotation_id);

CREATE TABLE annotation_tag_appeals (
  id text PRIMARY KEY,
  annotation_id text NOT NULL,
  tag_id text NOT NULL,
  origin text NOT NULL DEFAULT 'platform' CHECK (origin = 'platform'),
  submitted_by text NOT NULL CHECK (length(submitted_by) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_by text,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (annotation_id, tag_id, origin)
    REFERENCES annotation_tags(annotation_id, tag_id, origin) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND resolved_by IS NULL AND resolved_at IS NULL) OR
    (status <> 'pending' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX annotation_tag_appeals_pending_idx
  ON annotation_tag_appeals(status, created_at, id);

CREATE TABLE annotation_signals (
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  signal text NOT NULL CHECK (signal IN ('helpful', 'misleading')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, user_id)
);

CREATE TABLE annotation_saves (
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, user_id)
);
CREATE INDEX annotation_saves_user_idx ON annotation_saves(user_id, created_at DESC);

CREATE TABLE user_follows (
  follower_id text NOT NULL CHECK (length(follower_id) BETWEEN 1 AND 200),
  followed_id text NOT NULL CHECK (length(followed_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
CREATE INDEX user_follows_followed_idx ON user_follows(followed_id, follower_id);

CREATE TABLE direct_conversations (
  id text PRIMARY KEY,
  first_user_id text NOT NULL CHECK (length(first_user_id) BETWEEN 1 AND 200),
  second_user_id text NOT NULL CHECK (length(second_user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (first_user_id, second_user_id),
  CHECK (first_user_id < second_user_id)
);

CREATE TABLE direct_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL CHECK (length(sender_id) BETWEEN 1 AND 200),
  message_kind text NOT NULL CHECK (message_kind IN ('text', 'organization_invitation')),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  invitation jsonb CHECK (invitation IS NULL OR jsonb_typeof(invitation) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (message_kind = 'text' AND length(btrim(body)) > 0 AND invitation IS NULL) OR
    (message_kind = 'organization_invitation' AND invitation IS NOT NULL)
  )
);
CREATE INDEX direct_messages_conversation_idx
  ON direct_messages(conversation_id, created_at, id);

CREATE TABLE annotation_moderation_audit (
  id text PRIMARY KEY,
  annotation_id text NOT NULL REFERENCES annotations(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('withdraw', 'restore')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  admin_user_id text NOT NULL CHECK (length(admin_user_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER annotation_moderation_audit_append_only
BEFORE UPDATE OR DELETE ON annotation_moderation_audit
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
