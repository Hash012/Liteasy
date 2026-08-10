import { randomUUID } from "node:crypto";
import { withTransaction } from "./postgres.mjs";

export class ForumRepositoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requiredId(value, code = "RESOURCE_ID_INVALID") {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new ForumRepositoryError(code);
  }
  return value;
}

function normalizeTag(value) {
  return String(value ?? "").trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 32);
}

function tagSlug(value) {
  return normalizeTag(value).toLocaleLowerCase("zh-CN").replace(/\s+/g, "-");
}

function normalizedTags(values = []) {
  return [...new Map(values.map(normalizeTag).filter(Boolean).map((name) => [tagSlug(name), name])).values()];
}

function draftView(row) {
  return {
    ...row,
    citation_enabled: Boolean(row.citation_enabled),
    is_saved: row.is_saved ? 1 : 0,
    tags: Array.isArray(row.tags) ? row.tags : []
  };
}

function postView(row, viewerId) {
  return {
    ...row,
    has_citation: Boolean(row.excerpt),
    tags: Array.isArray(row.tags) ? row.tags : [],
    viewer_is_author: Boolean(viewerId && row.author_id === viewerId),
    viewer_saved: Boolean(row.viewer_saved),
    viewer_signal: row.viewer_signal ?? null
  };
}

function commentView(row) {
  return { ...row, viewer_saved: Boolean(row.viewer_saved) };
}

function userId(value) {
  return typeof value === "string" ? value : "";
}

const postSelect = `
  SELECT posts.*, topics.name AS topic_name, works.title AS work_title,
         viewer_signal.signal AS viewer_signal,
         (viewer_save.user_id IS NOT NULL) AS viewer_saved,
         COALESCE(
           array_agg(tags.name ORDER BY tags.name) FILTER (WHERE tags.id IS NOT NULL),
           ARRAY[]::text[]
         ) AS tags
    FROM posts
    JOIN topics ON topics.id = posts.topic_id
    LEFT JOIN works ON works.id = posts.work_id
    LEFT JOIN post_signals viewer_signal
      ON viewer_signal.post_id = posts.id AND viewer_signal.user_id = $1
    LEFT JOIN post_saves viewer_save
      ON viewer_save.post_id = posts.id AND viewer_save.user_id = $1
    LEFT JOIN post_tags ON post_tags.post_id = posts.id
    LEFT JOIN tags ON tags.id = post_tags.tag_id
`;

function postGroupAndOrder(limit = "") {
  return `
    GROUP BY posts.id, topics.name, works.title, viewer_signal.signal, viewer_save.user_id
    ORDER BY posts.helpful DESC, posts.created_at DESC, posts.id
    ${limit}
  `;
}

export class PostgresForumRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listAdminPosts() {
    const result = await this.pool.query(`
      SELECT id, topic_id, title, body, author_id, author_name, created_at, withdrawn_at
        FROM posts ORDER BY created_at DESC, id LIMIT 200
    `);
    return result.rows;
  }

  async moderatePost({ action, adminId, postId, reason, traceId }) {
    requiredId(adminId, "ADMIN_ID_INVALID");
    requiredId(postId, "POST_ID_INVALID");
    if (!new Set(["withdraw", "restore"]).has(action)) {
      throw new ForumRepositoryError("INVALID_MODERATION_ACTION");
    }
    const normalizedReason = String(reason ?? "").trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 1000) {
      throw new ForumRepositoryError("INVALID_MODERATION_ACTION");
    }
    return withTransaction(this.pool, async (client) => {
      const found = await client.query(
        "SELECT id, withdrawn_at FROM posts WHERE id = $1 FOR UPDATE",
        [postId]
      );
      if (!found.rows[0]) throw new ForumRepositoryError("POST_NOT_FOUND", 404);
      await client.query(
        "UPDATE posts SET withdrawn_at = $2 WHERE id = $1",
        [postId, action === "withdraw" ? (found.rows[0].withdrawn_at ?? new Date()) : null]
      );
      await client.query(`
        INSERT INTO moderation_audit(id, post_id, action, reason, admin_user_id, trace_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [`moderation_${randomUUID()}`, postId, action, normalizedReason, adminId, traceId]);
      return { action, ok: true, postId };
    });
  }

  async listTopics(viewerId) {
    const result = await this.pool.query(`
      SELECT topics.*,
             EXISTS(SELECT 1 FROM topic_follows f WHERE f.topic_id = topics.id AND f.user_id = $1) AS is_following,
             EXISTS(SELECT 1 FROM topic_saves s WHERE s.topic_id = topics.id AND s.user_id = $1) AS is_saved
        FROM topics ORDER BY follower_count DESC, created_at DESC, id
    `, [userId(viewerId)]);
    return result.rows;
  }

  async createTopic(input) {
    const id = `topic_${randomUUID()}`;
    const result = await this.pool.query(`
      INSERT INTO topics(id, name, description, guide)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, input.name.trim(), input.description.trim(), "由社区成员创建，等待更多阅读与校正。"]);
    return result.rows[0];
  }

  async topic(topicId, viewerId) {
    requiredId(topicId, "TOPIC_ID_INVALID");
    const result = await this.pool.query(`
      SELECT topics.*,
             EXISTS(SELECT 1 FROM topic_follows f WHERE f.topic_id = topics.id AND f.user_id = $2) AS is_following,
             EXISTS(SELECT 1 FROM topic_saves s WHERE s.topic_id = topics.id AND s.user_id = $2) AS is_saved
        FROM topics WHERE topics.id = $1
    `, [topicId, userId(viewerId)]);
    if (!result.rows[0]) throw new ForumRepositoryError("TOPIC_NOT_FOUND", 404);
    return result.rows[0];
  }

  async topicBundle(topicId, viewerId) {
    const topic = await this.topic(topicId, viewerId);
    const [works, posts] = await Promise.all([
      this.pool.query("SELECT * FROM works WHERE topic_id = $1 ORDER BY year DESC, id", [topicId]),
      this.listPosts(viewerId, { topicId })
    ]);
    return { posts, topic, works: works.rows };
  }

  async workBundle(workId, viewerId) {
    requiredId(workId, "WORK_ID_INVALID");
    const work = await this.pool.query("SELECT * FROM works WHERE id = $1", [workId]);
    if (!work.rows[0]) throw new ForumRepositoryError("WORK_NOT_FOUND", 404);
    const [topic, posts] = await Promise.all([
      this.topic(work.rows[0].topic_id, viewerId),
      this.listPosts(viewerId, { workId })
    ]);
    return { posts, topic, work: work.rows[0] };
  }

  async toggleFollow(topicId, viewerId) {
    requiredId(topicId, "TOPIC_ID_INVALID");
    requiredId(viewerId, "USER_ID_INVALID");
    return withTransaction(this.pool, async (client) => {
      const topic = await client.query("SELECT id FROM topics WHERE id = $1 FOR UPDATE", [topicId]);
      if (!topic.rows[0]) throw new ForumRepositoryError("TOPIC_NOT_FOUND", 404);
      const removed = await client.query(
        "DELETE FROM topic_follows WHERE topic_id = $1 AND user_id = $2 RETURNING topic_id",
        [topicId, viewerId]
      );
      const following = removed.rowCount === 0;
      if (following) {
        await client.query(
          "INSERT INTO topic_follows(topic_id, user_id) VALUES ($1, $2)",
          [topicId, viewerId]
        );
      }
      const updated = await client.query(`
        UPDATE topics SET follower_count = (
          SELECT count(*) FROM topic_follows WHERE topic_id = $1
        ) WHERE id = $1 RETURNING follower_count
      `, [topicId]);
      return { followerCount: Number(updated.rows[0].follower_count), following };
    });
  }

  async toggleSave(targetType, targetId, viewerId) {
    requiredId(targetId, "SAVE_TARGET_INVALID");
    requiredId(viewerId, "USER_ID_INVALID");
    const targets = {
      comment: { id: "comment_id", save: "comment_saves", source: "comments" },
      post: { id: "post_id", save: "post_saves", source: "posts" },
      topic: { id: "topic_id", save: "topic_saves", source: "topics" }
    };
    const target = targets[targetType];
    if (!target) throw new ForumRepositoryError("SAVE_TARGET_INVALID");
    return withTransaction(this.pool, async (client) => {
      let found;
      if (targetType === "comment") {
        found = await client.query(`
          SELECT comments.id FROM comments JOIN posts ON posts.id = comments.post_id
           WHERE comments.id = $1 AND posts.withdrawn_at IS NULL FOR UPDATE OF comments
        `, [targetId]);
      } else if (targetType === "post") {
        found = await client.query(
          "SELECT id FROM posts WHERE id = $1 AND withdrawn_at IS NULL FOR UPDATE",
          [targetId]
        );
      } else {
        found = await client.query("SELECT id FROM topics WHERE id = $1 FOR UPDATE", [targetId]);
      }
      if (!found.rows[0]) {
        throw new ForumRepositoryError(`${targetType.toUpperCase()}_NOT_FOUND`, 404);
      }
      const removed = await client.query(
        `DELETE FROM ${target.save} WHERE ${target.id} = $1 AND user_id = $2 RETURNING ${target.id}`,
        [targetId, viewerId]
      );
      if (removed.rowCount > 0) return { saved: false };
      await client.query(
        `INSERT INTO ${target.save}(${target.id}, user_id) VALUES ($1, $2)`,
        [targetId, viewerId]
      );
      return { saved: true };
    });
  }

  async createContextualDraft(viewerId, input) {
    return this.#createContextualDraft(this.pool, viewerId, input);
  }

  async #draftTarget(client, input) {
    const topicId = requiredId(input.topicId, "TOPIC_ID_INVALID");
    const workId = input.workId ? requiredId(input.workId, "WORK_ID_INVALID") : null;
    const target = await client.query(`
      SELECT topics.id AS topic_id, works.id AS work_id
        FROM topics
        LEFT JOIN works ON works.topic_id = topics.id AND works.id = $2
       WHERE topics.id = $1
    `, [topicId, workId]);
    if (!target.rows[0]) throw new ForumRepositoryError("TOPIC_NOT_FOUND", 404);
    if (workId && !target.rows[0].work_id) throw new ForumRepositoryError("WORK_NOT_FOUND", 404);
    return { topicId, workId };
  }

  async #createContextualDraft(client, viewerId, input, update = {}) {
    requiredId(viewerId, "USER_ID_INVALID");
    const { topicId, workId } = await this.#draftTarget(client, input);
    const id = `draft_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await client.query(`
      INSERT INTO drafts(
        id, work_id, topic_id, page, excerpt, anchor_hash, language, owner_id,
        body, title, tags, citation_enabled, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
    `, [
      id, workId, topicId, input.page ?? null, input.excerpt ?? null,
      input.anchorHash ?? null, input.language, viewerId, update.body ?? "", update.title ?? null,
      JSON.stringify(normalizedTags(update.tags ?? [])),
      update.citationEnabled ?? input.citationEnabled, expiresAt
    ]);
    return { draftId: id, expiresAt };
  }

  async createDraftHandoff(viewerId, input) {
    requiredId(viewerId, "USER_ID_INVALID");
    await this.#draftTarget(this.pool, input.context);
    const handoffId = `handoff_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.pool.query(`
      INSERT INTO desktop_draft_handoffs(id, owner_id, context, draft_update, expires_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
    `, [
      handoffId,
      viewerId,
      JSON.stringify(input.context),
      input.update ? JSON.stringify(input.update) : null,
      expiresAt
    ]);
    return { expiresAt, handoffId };
  }

  async consumeDraftHandoff(handoffId, viewerId) {
    requiredId(handoffId, "HANDOFF_ID_INVALID");
    requiredId(viewerId, "USER_ID_INVALID");
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        "SELECT * FROM desktop_draft_handoffs WHERE id = $1 FOR UPDATE",
        [handoffId]
      );
      const handoff = result.rows[0];
      if (!handoff) throw new ForumRepositoryError("HANDOFF_NOT_FOUND", 404);
      if (handoff.owner_id !== viewerId) throw new ForumRepositoryError("HANDOFF_FORBIDDEN", 403);
      if (handoff.consumed_at) return { draftId: handoff.draft_id, replayed: true };
      if (handoff.expires_at <= new Date()) throw new ForumRepositoryError("HANDOFF_EXPIRED", 410);
      const created = await this.#createContextualDraft(
        client,
        viewerId,
        handoff.context,
        handoff.draft_update ?? {}
      );
      await client.query(`
        UPDATE desktop_draft_handoffs
           SET consumed_at = now(), draft_id = $2
         WHERE id = $1
      `, [handoffId, created.draftId]);
      return { ...created, replayed: false };
    });
  }

  async #ownedDraft(client, draftId, viewerId, { lock = false } = {}) {
    requiredId(draftId, "DRAFT_ID_INVALID");
    requiredId(viewerId, "USER_ID_INVALID");
    const result = await client.query(
      `SELECT * FROM drafts WHERE id = $1 AND discarded_at IS NULL${lock ? " FOR UPDATE" : ""}`,
      [draftId]
    );
    const draft = result.rows[0];
    if (!draft || (!draft.is_saved && draft.expires_at && draft.expires_at < new Date())) {
      throw new ForumRepositoryError("DRAFT_EXPIRED", 410);
    }
    if (draft.owner_id !== viewerId) throw new ForumRepositoryError("DRAFT_FORBIDDEN", 403);
    return draft;
  }

  async draftBundle(draftId, viewerId) {
    const draft = await this.#ownedDraft(this.pool, draftId, viewerId);
    const [topic, work] = await Promise.all([
      this.pool.query("SELECT * FROM topics WHERE id = $1", [draft.topic_id]),
      draft.work_id
        ? this.pool.query("SELECT * FROM works WHERE id = $1", [draft.work_id])
        : Promise.resolve({ rows: [] })
    ]);
    return { draft: draftView(draft), topic: topic.rows[0], work: work.rows[0] ?? null };
  }

  async listDrafts(viewerId) {
    requiredId(viewerId, "USER_ID_INVALID");
    const result = await this.pool.query(`
      SELECT drafts.*, works.title AS work_title, topics.name AS topic_name
        FROM drafts
        JOIN topics ON topics.id = drafts.topic_id
        LEFT JOIN works ON works.id = drafts.work_id
       WHERE drafts.owner_id = $1
         AND drafts.discarded_at IS NULL
         AND drafts.published_post_id IS NULL
         AND (drafts.is_saved OR drafts.expires_at >= now())
       ORDER BY drafts.updated_at DESC, drafts.id
    `, [viewerId]);
    return result.rows.map((row) => ({
      draft: draftView(row),
      topic: { id: row.topic_id, name: row.topic_name },
      work: row.work_id ? { id: row.work_id, title: row.work_title } : null
    }));
  }

  async listFollowing(viewerId) {
    requiredId(viewerId, "USER_ID_INVALID");
    const result = await this.pool.query(`
      SELECT topics.*, true AS is_following,
             EXISTS(SELECT 1 FROM topic_saves s WHERE s.topic_id = topics.id AND s.user_id = $1) AS is_saved
        FROM topics JOIN topic_follows f ON f.topic_id = topics.id
       WHERE f.user_id = $1 ORDER BY f.created_at DESC, topics.id
    `, [viewerId]);
    return result.rows;
  }

  async listSaved(viewerId) {
    requiredId(viewerId, "USER_ID_INVALID");
    const [topics, posts, comments] = await Promise.all([
      this.pool.query(`
        SELECT topics.*,
               EXISTS(SELECT 1 FROM topic_follows f WHERE f.topic_id = topics.id AND f.user_id = $1) AS is_following,
               true AS is_saved
          FROM topics JOIN topic_saves s ON s.topic_id = topics.id
         WHERE s.user_id = $1 ORDER BY s.created_at DESC, topics.id
      `, [viewerId]),
      this.listPosts(viewerId, { savedBy: viewerId }),
      this.listComments(viewerId, { savedBy: viewerId })
    ]);
    return { comments, posts, topics: topics.rows };
  }

  async updateDraft(draftId, viewerId, input) {
    return withTransaction(this.pool, async (client) => {
      const draft = await this.#ownedDraft(client, draftId, viewerId, { lock: true });
      if (draft.published_post_id) throw new ForumRepositoryError("DRAFT_PUBLISHED", 409);
      const topicId = requiredId(input.topicId ?? draft.topic_id, "TOPIC_ID_INVALID");
      const topic = await client.query("SELECT id FROM topics WHERE id = $1", [topicId]);
      if (!topic.rows[0]) throw new ForumRepositoryError("TOPIC_NOT_FOUND", 404);
      if (input.citationEnabled && (!draft.work_id || !draft.excerpt || !draft.page || !draft.anchor_hash)) {
        throw new ForumRepositoryError("INVALID_CITATION");
      }
      const updated = await client.query(`
        UPDATE drafts
           SET topic_id = $2, body = $3, title = $4, tags = $5::jsonb,
               citation_enabled = $6, is_saved = true, updated_at = now(), expires_at = NULL
         WHERE id = $1 RETURNING updated_at
      `, [
        draftId, topicId, input.body, input.title ?? null,
        JSON.stringify(normalizedTags(input.tags)), input.citationEnabled
      ]);
      return { draftId, ok: true, updatedAt: updated.rows[0].updated_at };
    });
  }

  async discardDraft(draftId, viewerId) {
    return withTransaction(this.pool, async (client) => {
      const draft = await this.#ownedDraft(client, draftId, viewerId, { lock: true });
      if (draft.published_post_id) throw new ForumRepositoryError("DRAFT_PUBLISHED", 409);
      await client.query("UPDATE drafts SET discarded_at = now(), updated_at = now() WHERE id = $1", [draftId]);
      return { draftId, ok: true };
    });
  }

  async #attachTags(client, postId, names) {
    for (const name of normalizedTags(names)) {
      const slug = tagSlug(name);
      const tag = await client.query(`
        INSERT INTO tags(id, slug, name) VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE SET name = tags.name
        RETURNING id
      `, [`tag_${randomUUID()}`, slug, name]);
      await client.query(
        "INSERT INTO post_tags(post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [postId, tag.rows[0].id]
      );
    }
  }

  async publishDraft(draftId, user) {
    return withTransaction(this.pool, async (client) => {
      const draft = await this.#ownedDraft(client, draftId, user.id, { lock: true });
      if (!draft.body.trim()) throw new ForumRepositoryError("DRAFT_EMPTY");
      if (draft.published_post_id) {
        return {
          postId: draft.published_post_id,
          replayed: true,
          topicId: draft.topic_id,
          workId: draft.work_id
        };
      }
      const postId = `post_${randomUUID()}`;
      await client.query(`
        INSERT INTO posts(
          id, topic_id, work_id, title, body, author_id, author_name, author_initials,
          page, excerpt, anchor_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        postId, draft.topic_id, draft.work_id, draft.title, draft.body,
        user.id, user.name, user.initials,
        draft.citation_enabled ? draft.page : null,
        draft.citation_enabled ? draft.excerpt : null,
        draft.citation_enabled ? draft.anchor_hash : null
      ]);
      await this.#attachTags(client, postId, draft.tags);
      await client.query(
        "UPDATE drafts SET published_post_id = $2, updated_at = now() WHERE id = $1",
        [draftId, postId]
      );
      return { postId, replayed: false, topicId: draft.topic_id, workId: draft.work_id };
    });
  }

  async listPosts(viewerId, criteria = {}) {
    const values = [userId(viewerId)];
    const clauses = ["posts.withdrawn_at IS NULL"];
    if (criteria.topicId) {
      values.push(requiredId(criteria.topicId, "TOPIC_ID_INVALID"));
      clauses.push(`posts.topic_id = $${values.length}`);
    }
    if (criteria.workId) {
      values.push(requiredId(criteria.workId, "WORK_ID_INVALID"));
      clauses.push(`posts.work_id = $${values.length}`);
    }
    if (criteria.authorId) {
      values.push(requiredId(criteria.authorId, "USER_ID_INVALID"));
      clauses.push(`posts.author_id = $${values.length}`);
    }
    if (criteria.savedBy) {
      values.push(requiredId(criteria.savedBy, "USER_ID_INVALID"));
      clauses.push(`EXISTS(SELECT 1 FROM post_saves saved WHERE saved.post_id = posts.id AND saved.user_id = $${values.length})`);
    }
    if (criteria.query) {
      values.push(`%${String(criteria.query).trim()}%`);
      clauses.push(`(posts.body ILIKE $${values.length} OR COALESCE(posts.title, '') ILIKE $${values.length} OR topics.name ILIKE $${values.length})`);
    }
    if (criteria.tag) {
      values.push(tagSlug(criteria.tag));
      clauses.push(`EXISTS(
        SELECT 1 FROM post_tags searched_post_tags
        JOIN tags searched_tags ON searched_tags.id = searched_post_tags.tag_id
        WHERE searched_post_tags.post_id = posts.id AND searched_tags.slug = $${values.length}
      )`);
    }
    const limit = criteria.limit ? `LIMIT ${Math.min(100, Math.max(1, criteria.limit))}` : "";
    const result = await this.pool.query(
      `${postSelect} WHERE ${clauses.join(" AND ")} ${postGroupAndOrder(limit)}`,
      values
    );
    return result.rows.map((row) => postView(row, viewerId));
  }

  async contextualFeed(workId, anchorHash, viewerId) {
    const posts = await this.listPosts(viewerId, { workId });
    return posts.sort((left, right) =>
      Number(right.anchor_hash === anchorHash) - Number(left.anchor_hash === anchorHash) ||
      Number(right.helpful) - Number(left.helpful)
    ).slice(0, 3);
  }

  async search(query, tag, viewerId) {
    return this.listPosts(viewerId, { query: query || undefined, tag: tag || undefined, limit: 30 });
  }

  async toggleSignal(postId, viewerId, signal) {
    requiredId(postId, "POST_ID_INVALID");
    requiredId(viewerId, "USER_ID_INVALID");
    if (!new Set(["helpful", "misleading"]).has(signal)) {
      throw new ForumRepositoryError("INVALID_SIGNAL");
    }
    return withTransaction(this.pool, async (client) => {
      const post = await client.query(
        "SELECT id FROM posts WHERE id = $1 AND withdrawn_at IS NULL FOR UPDATE",
        [postId]
      );
      if (!post.rows[0]) throw new ForumRepositoryError("POST_NOT_FOUND", 404);
      const previous = await client.query(
        "SELECT signal FROM post_signals WHERE post_id = $1 AND user_id = $2 FOR UPDATE",
        [postId, viewerId]
      );
      let selectedSignal = signal;
      if (previous.rows[0]?.signal === signal) {
        await client.query("DELETE FROM post_signals WHERE post_id = $1 AND user_id = $2", [postId, viewerId]);
        selectedSignal = null;
      } else {
        await client.query(`
          INSERT INTO post_signals(post_id, user_id, signal) VALUES ($1, $2, $3)
          ON CONFLICT (post_id, user_id)
          DO UPDATE SET signal = EXCLUDED.signal, created_at = now()
        `, [postId, viewerId, signal]);
      }
      const counts = await client.query(`
        UPDATE posts SET
          helpful = (SELECT count(*) FROM post_signals WHERE post_id = $1 AND signal = 'helpful'),
          misleading = (SELECT count(*) FROM post_signals WHERE post_id = $1 AND signal = 'misleading')
        WHERE id = $1 RETURNING helpful
      `, [postId]);
      return { helpful: Number(counts.rows[0].helpful), ok: true, selectedSignal };
    });
  }

  async listComments(viewerId, criteria = {}) {
    const values = [userId(viewerId)];
    const clauses = ["posts.withdrawn_at IS NULL"];
    if (criteria.postId) {
      values.push(requiredId(criteria.postId, "POST_ID_INVALID"));
      clauses.push(`comments.post_id = $${values.length}`);
    }
    if (criteria.savedBy) {
      values.push(requiredId(criteria.savedBy, "USER_ID_INVALID"));
      clauses.push(`saved.user_id = $${values.length}`);
    }
    const result = await this.pool.query(`
      SELECT comments.*, posts.title AS post_title, posts.topic_id, posts.work_id,
             (saved.user_id IS NOT NULL) AS viewer_saved
        FROM comments
        JOIN posts ON posts.id = comments.post_id
        LEFT JOIN comment_saves saved ON saved.comment_id = comments.id AND saved.user_id = $1
       WHERE ${clauses.join(" AND ")}
       ORDER BY comments.created_at, comments.id
    `, values);
    return result.rows.map(commentView);
  }

  async createComment(postId, user, body) {
    requiredId(postId, "POST_ID_INVALID");
    const text = String(body ?? "").trim();
    if (text.length < 1 || text.length > 2000) throw new ForumRepositoryError("INVALID_COMMENT");
    const post = await this.pool.query(
      "SELECT id FROM posts WHERE id = $1 AND withdrawn_at IS NULL",
      [postId]
    );
    if (!post.rows[0]) throw new ForumRepositoryError("POST_NOT_FOUND", 404);
    const result = await this.pool.query(`
      INSERT INTO comments(id, post_id, body, author_id, author_name, author_initials)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *, false AS viewer_saved
    `, [`comment_${randomUUID()}`, postId, text, user.id, user.name, user.initials]);
    return commentView(result.rows[0]);
  }

  async withdrawPost(postId, viewerId) {
    requiredId(postId, "POST_ID_INVALID");
    requiredId(viewerId, "USER_ID_INVALID");
    const result = await this.pool.query(`
      UPDATE posts SET withdrawn_at = now()
       WHERE id = $1 AND withdrawn_at IS NULL AND author_id = $2
       RETURNING id
    `, [postId, viewerId]);
    if (result.rows[0]) return { ok: true, postId };
    const found = await this.pool.query("SELECT author_id, withdrawn_at FROM posts WHERE id = $1", [postId]);
    if (!found.rows[0] || found.rows[0].withdrawn_at) {
      throw new ForumRepositoryError("POST_NOT_FOUND", 404);
    }
    throw new ForumRepositoryError("NOT_POST_AUTHOR", 403);
  }

  async createFeedback(input, viewerId) {
    await this.pool.query(`
      INSERT INTO feedback(id, kind, message, context, submitted_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      `feedback_${randomUUID()}`, input.kind, input.message,
      input.context ?? null, viewerId ?? null
    ]);
    return { ok: true };
  }
}

export const forumText = Object.freeze({ normalizeTag, tagSlug });
