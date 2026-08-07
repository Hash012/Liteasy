CREATE TABLE topics (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 8 AND 300),
  guide text NOT NULL CHECK (length(btrim(guide)) BETWEEN 1 AND 1000),
  follower_count bigint NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE works (
  id text PRIMARY KEY,
  topic_id text NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 1000),
  authors text NOT NULL CHECK (length(btrim(authors)) BETWEEN 1 AND 4000),
  year integer NOT NULL CHECK (year BETWEEN 1000 AND 9999),
  venue text NOT NULL CHECK (length(btrim(venue)) BETWEEN 1 AND 1000),
  identifier text,
  abstract text NOT NULL CHECK (length(abstract) <= 100000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX works_topic_year_idx ON works(topic_id, year DESC, id);

CREATE TABLE posts (
  id text PRIMARY KEY,
  topic_id text NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  work_id text REFERENCES works(id) ON DELETE RESTRICT,
  title text CHECK (title IS NULL OR length(title) <= 180),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author_id text NOT NULL CHECK (length(author_id) BETWEEN 1 AND 200),
  author_name text NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 200),
  author_initials text NOT NULL CHECK (length(author_initials) BETWEEN 1 AND 8),
  page integer CHECK (page IS NULL OR page > 0),
  excerpt text CHECK (excerpt IS NULL OR length(excerpt) BETWEEN 8 AND 2000),
  anchor_hash text CHECK (anchor_hash IS NULL OR length(anchor_hash) >= 8),
  helpful bigint NOT NULL DEFAULT 0 CHECK (helpful >= 0),
  misleading bigint NOT NULL DEFAULT 0 CHECK (misleading >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  CHECK (
    (page IS NULL AND excerpt IS NULL AND anchor_hash IS NULL) OR
    (work_id IS NOT NULL AND page IS NOT NULL AND excerpt IS NOT NULL AND anchor_hash IS NOT NULL)
  )
);
CREATE INDEX posts_topic_visible_idx ON posts(topic_id, helpful DESC, created_at DESC)
  WHERE withdrawn_at IS NULL;
CREATE INDEX posts_work_visible_idx ON posts(work_id, helpful DESC, created_at DESC)
  WHERE withdrawn_at IS NULL;
CREATE INDEX posts_author_idx ON posts(author_id, created_at DESC);

CREATE TABLE drafts (
  id text PRIMARY KEY,
  work_id text REFERENCES works(id) ON DELETE RESTRICT,
  topic_id text NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  page integer CHECK (page IS NULL OR page > 0),
  excerpt text CHECK (excerpt IS NULL OR length(excerpt) BETWEEN 8 AND 2000),
  anchor_hash text CHECK (anchor_hash IS NULL OR length(anchor_hash) >= 8),
  language text NOT NULL CHECK (length(language) BETWEEN 2 AND 35),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  title text CHECK (title IS NULL OR length(title) <= 180),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  citation_enabled boolean NOT NULL DEFAULT false,
  is_saved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  published_post_id text UNIQUE REFERENCES posts(id) ON DELETE RESTRICT,
  discarded_at timestamptz,
  CHECK (
    NOT citation_enabled OR
    (work_id IS NOT NULL AND page IS NOT NULL AND excerpt IS NOT NULL AND anchor_hash IS NOT NULL)
  )
);
CREATE INDEX drafts_owner_active_idx ON drafts(owner_id, updated_at DESC)
  WHERE discarded_at IS NULL AND published_post_id IS NULL;

CREATE TABLE tags (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 32)
);

CREATE TABLE post_tags (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX post_tags_tag_idx ON post_tags(tag_id, post_id);

CREATE TABLE post_signals (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  signal text NOT NULL CHECK (signal IN ('helpful', 'misleading')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  author_id text NOT NULL CHECK (length(author_id) BETWEEN 1 AND 200),
  author_name text NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 200),
  author_initials text NOT NULL CHECK (length(author_initials) BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_created_idx ON comments(post_id, created_at, id);

CREATE TABLE topic_follows (
  topic_id text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX topic_follows_user_idx ON topic_follows(user_id, created_at DESC);

CREATE TABLE topic_saves (
  topic_id text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX topic_saves_user_idx ON topic_saves(user_id, created_at DESC);

CREATE TABLE post_saves (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_saves_user_idx ON post_saves(user_id, created_at DESC);

CREATE TABLE comment_saves (
  comment_id text NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX comment_saves_user_idx ON comment_saves(user_id, created_at DESC);

CREATE TABLE feedback (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('bug', 'idea', 'experience')),
  message text NOT NULL CHECK (length(message) BETWEEN 8 AND 2000),
  context text CHECK (context IS NULL OR length(context) <= 300),
  submitted_by text CHECK (submitted_by IS NULL OR length(submitted_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderation_audit (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('withdraw', 'restore')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  admin_user_id text NOT NULL CHECK (length(admin_user_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_audit_post_idx ON moderation_audit(post_id, created_at DESC, id);

CREATE FUNCTION reject_moderation_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation_audit_is_append_only';
END;
$$;

CREATE TRIGGER moderation_audit_append_only
BEFORE UPDATE OR DELETE ON moderation_audit
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
