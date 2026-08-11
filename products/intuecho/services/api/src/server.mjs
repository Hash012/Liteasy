import Fastify from "fastify";
import cors from "@fastify/cors";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  communityRecommendationQuerySchema,
  contextualDraftSchema,
  createFeedbackSchema,
  createPostSchema,
  createTopicSchema,
  desktopDraftHandoffSchema,
  signalSchema,
  updateDraftSchema
} from "@intuecho/contracts";
import { createIdentityVerifier, IdentityVerificationError } from "./identityVerifier.mjs";
import { loadDevelopmentLiteratureProviderConfig } from "./developmentLiteratureProviderConfig.mjs";
import {
  assertIntuechoDevelopmentBoundary,
  prepareIntuechoDatabasePath,
  secureIntuechoDatabaseFiles
} from "./storageBoundary.mjs";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { registerAnnotationCommunityRoutes } from "./annotationCommunityRoutes.mjs";
import { createLiteratureProviders } from "./literatureProviders.mjs";
import { createLiteratureRateLimiter } from "./literatureRateLimiter.mjs";
import { createLiteratureResolver } from "./literatureResolver.mjs";
import { LiteratureRouteError, registerLiteratureRoutes } from "./literatureRoutes.mjs";

function normalizeTag(value) {
  return value.trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 32);
}

function tagSlug(value) {
  return normalizeTag(value).toLocaleLowerCase("zh-CN").replace(/\s+/g, "-");
}

function normalizeTags(values = []) {
  return [...new Map(values.map(normalizeTag).filter(Boolean).map((name) => [tagSlug(name), name])).values()];
}

function createDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(databasePath), 0o700);
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, guide TEXT NOT NULL, follower_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, title TEXT NOT NULL, authors TEXT NOT NULL, year INTEGER NOT NULL, venue TEXT NOT NULL, identifier TEXT, abstract TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, work_id TEXT, title TEXT, body TEXT NOT NULL, author_id TEXT, author_name TEXT NOT NULL, author_initials TEXT NOT NULL, page INTEGER, excerpt TEXT, anchor_hash TEXT, helpful INTEGER NOT NULL DEFAULT 0, misleading INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, withdrawn_at TEXT);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, work_id TEXT, topic_id TEXT NOT NULL, page INTEGER, excerpt TEXT, anchor_hash TEXT, language TEXT NOT NULL, owner_id TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', title TEXT, tags_json TEXT NOT NULL DEFAULT '[]', citation_enabled INTEGER NOT NULL DEFAULT 0, is_saved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT, published_post_id TEXT, discarded_at TEXT);
    CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS post_tags (post_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (post_id, tag_id));
    CREATE TABLE IF NOT EXISTS post_signals (post_id TEXT NOT NULL, user_id TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('helpful', 'misleading')), created_at TEXT NOT NULL, PRIMARY KEY (post_id, user_id));
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, body TEXT NOT NULL, author_id TEXT, author_name TEXT NOT NULL, author_initials TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS topic_follows (topic_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (topic_id, user_id));
    CREATE TABLE IF NOT EXISTS saves (target_type TEXT NOT NULL CHECK(target_type IN ('topic', 'post', 'comment')), target_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (target_type, target_id, user_id));
    CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, context TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation_audit (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('withdraw', 'restore')), reason TEXT NOT NULL, admin_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS desktop_draft_handoffs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, context_json TEXT NOT NULL, update_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, draft_id TEXT);
    CREATE INDEX IF NOT EXISTS desktop_draft_handoffs_owner_expiry_idx ON desktop_draft_handoffs(owner_id, expires_at);
    CREATE TABLE IF NOT EXISTS community_annotations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_annotation_id TEXT NOT NULL, queue_key TEXT NOT NULL, paper_identity_kind TEXT NOT NULL, paper_identity_value TEXT NOT NULL, scope_kind TEXT NOT NULL, scope_json TEXT NOT NULL, body TEXT NOT NULL, excerpt TEXT NOT NULL, source_created_at TEXT NOT NULL, source_updated_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id, queue_key));
    CREATE INDEX IF NOT EXISTS community_annotations_paper_idx ON community_annotations(paper_identity_kind, paper_identity_value, updated_at DESC);
  `);
  const postColumns = new Set(db.prepare("PRAGMA table_info(posts)").all().map((column) => column.name));
  if (!postColumns.has("author_id")) db.exec("ALTER TABLE posts ADD COLUMN author_id TEXT");
  const commentColumns = new Set(db.prepare("PRAGMA table_info(comments)").all().map((column) => column.name));
  if (!commentColumns.has("author_id")) db.exec("ALTER TABLE comments ADD COLUMN author_id TEXT");
  secureIntuechoDatabaseFiles(databasePath);
  return db;
}

function viewer(request) { return request.intuechoUser ?? null; }
function requireUser(request, reply) {
  const user = viewer(request);
  if (!user) { reply.code(401).send({ error: "AUTH_REQUIRED", message: "登录后才能进行此操作。", traceId: request.id }); return null; }
  return user;
}

export async function createIntuechoApp({
  adminIdentityVerifier = createIdentityVerifier({
    endpointPath: "/v1/admin/session",
    expectedAudience: "liteasy-admin",
    useBearer: true
  }),
  authorizeOrganizationAccess,
  authorizeOrganizationInvitation,
  authorizeOrganizationVisibility,
  listOrganizations,
  literatureProviderConfig = loadDevelopmentLiteratureProviderConfig(),
  literatureRateLimiter,
  literatureResolver,
  literatureServiceIdentityVerifier = createIdentityVerifier({ expectedAudience: "intuecho-internal" }),
  databasePath,
  desktopIdentityVerifier = createIdentityVerifier({ expectedAudience: "liteasy-desktop" }),
  desktopOrigins = (process.env.INTUECHO_DESKTOP_ORIGINS ?? "http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost")
    .split(",").map((value) => value.trim()).filter(Boolean),
  environment = process.env.NODE_ENV,
  identityVerifier = createIdentityVerifier(),
  webOrigin = process.env.INTUECHO_WEB_ORIGIN ?? "http://127.0.0.1:5174"
} = {}) {
  assertIntuechoDevelopmentBoundary(environment);
  const storage = prepareIntuechoDatabasePath({ configuredPath: databasePath });
  const db = createDatabase(storage.databasePath);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: [webOrigin, ...desktopOrigins] });
  app.decorateRequest("intuechoAdmin", null);
  app.decorateRequest("intuechoDesktopUser", null);
  app.decorateRequest("intuechoLiteratureService", null);
  app.decorateRequest("intuechoUser", null);
  app.addHook("preHandler", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization) return;
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
      return reply.code(401).send({ error: "INVALID_AUTHORIZATION", message: "登录凭据格式无效。", traceId: request.id });
    }
    try {
      if (isInternalLiteratureRequest(request)) {
        request.intuechoLiteratureService = await literatureServiceIdentityVerifier(match[1]);
      } else if (request.url.startsWith("/v1/admin/")) {
        request.intuechoAdmin = await adminIdentityVerifier(match[1]);
      } else if (isLiteratureRequest(request)) {
        request.intuechoUser = await identityVerifier(match[1]);
      } else if (isDesktopIntegrationRequest(request)) {
        request.intuechoDesktopUser = await desktopIdentityVerifier(match[1]);
      } else {
        request.intuechoUser = await identityVerifier(match[1]);
      }
    } catch (error) {
      if (error instanceof IdentityVerificationError) {
        return reply.code(error.statusCode ?? 401).send({
          error: error.code ?? "INVALID_SESSION",
          message: error.message ?? "登录会话无效或已过期。",
          traceId: request.id
        });
      }
      console.error(`[intuecho-dev] ${request.id}`, error);
      return reply.code(503).send({ error: "IDENTITY_SERVICE_UNAVAILABLE", message: "身份服务暂时不可用，请稍后重试。", traceId: request.id });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof LiteratureRouteError) {
      return reply.code(error.status).send({ error: error.code, traceId: request.id });
    }
    throw error;
  });

  function isDesktopIntegrationRequest(request) {
    const pathname = request.url.split("?", 1)[0];
    return request.method === "POST" && new Set([
      "/v1/integrations/desktop/draft-handoffs",
      "/v1/integrations/desktop/annotation-handoffs",
      "/v1/pdf-annotations:sync",
      "/v1/thin-reading/annotations:sync",
      "/v1/thin-reading/recommendations:query",
      "/v1/integrations/desktop/works:resolve"
    ]).has(pathname);
  }

  function isLiteratureRequest(request) {
    const pathname = request.url.split("?", 1)[0];
    if (request.method === "GET") return /^\/v1\/literature\/[^/]+\/relations$/.test(pathname);
    return request.method === "POST" && new Set(["/v1/literature:resolve", "/v1/literature:confirm"]).has(pathname);
  }

  function isInternalLiteratureRequest(request) {
    const pathname = request.url.split("?", 1)[0];
    return pathname === "/v1/internal/literature:verify" ||
      pathname === "/v1/internal/literature:resolve" ||
      pathname === "/v1/internal/literature:confirm" ||
      /^\/v1\/internal\/literature\/[^/]+\/relations$/.test(pathname);
  }

  function requireDesktopUser(request, reply) {
    if (request.intuechoDesktopUser) return request.intuechoDesktopUser;
    reply.code(401).send({
      error: "DESKTOP_AUTH_REQUIRED",
      message: "需要 Liteasy 桌面会话。",
      traceId: request.id
    });
    return null;
  }

  function requireAdmin(request, reply) {
    if (!request.intuechoAdmin) {
      reply.code(401).send({
        error: "ADMIN_AUTH_REQUIRED",
        message: "需要平台管理员登录。",
        traceId: request.id
      });
      return null;
    }
    return request.intuechoAdmin;
  }

  const annotationCommunity = new SqliteAnnotationCommunityRepository(db, {
    authorizeOrganizationAccess,
    authorizeOrganizationInvitation,
    authorizeOrganizationVisibility,
    listOrganizations
  });
  const configuredLiteratureResolver = literatureResolver ?? createLiteratureResolver({
    providers: createLiteratureProviders(literatureProviderConfig, { fetchImpl: globalThis.fetch }),
    repository: annotationCommunity
  });
  registerAnnotationCommunityRoutes(app, annotationCommunity, {
    currentUser: viewer,
    requireAdmin,
    requireDesktopUser,
    requireUser
  });
  registerLiteratureRoutes(app, {
    currentUser: (request) => request.intuechoUser ?? request.intuechoDesktopUser ?? null,
    rateLimiter: literatureRateLimiter ?? createLiteratureRateLimiter(),
    requireService: (request, reply) => {
      if (request.intuechoLiteratureService) return request.intuechoLiteratureService;
      reply.code(401).send({ error: "LITERATURE_SERVICE_AUTH_REQUIRED", traceId: request.id });
      return null;
    },
    requireUser,
    resolver: configuredLiteratureResolver
  });

  function tagsForPost(postId) { return db.prepare("SELECT tags.name FROM tags JOIN post_tags ON post_tags.tag_id = tags.id WHERE post_tags.post_id = ? ORDER BY tags.name").all(postId).map((tag) => tag.name); }
  function serializePost(row, request) { return { ...row, tags: tagsForPost(row.id), has_citation: Boolean(row.excerpt), viewer_signal: row.viewer_signal ?? null, viewer_saved: Boolean(row.viewer_saved), viewer_is_author: Boolean(viewer(request)?.id && row.author_id === viewer(request).id) }; }
  function visiblePosts(request, where = "", params = []) {
    const userId = viewer(request)?.id ?? "";
    return db.prepare(`SELECT posts.*, topics.name AS topic_name, works.title AS work_title, signals.signal AS viewer_signal, saves.target_id AS viewer_saved FROM posts LEFT JOIN topics ON topics.id = posts.topic_id LEFT JOIN works ON works.id = posts.work_id LEFT JOIN post_signals AS signals ON signals.post_id = posts.id AND signals.user_id = ? LEFT JOIN saves ON saves.target_type = 'post' AND saves.target_id = posts.id AND saves.user_id = ? WHERE posts.withdrawn_at IS NULL ${where} ORDER BY posts.helpful DESC, posts.created_at DESC`).all(userId, userId, ...params).map((row) => serializePost(row, request));
  }
  function serializeComment(row) { return { ...row, viewer_saved: Boolean(row.viewer_saved) }; }
  function visibleComments(request, postId = null, where = "", params = []) {
    const userId = viewer(request)?.id ?? "";
    const postClause = postId ? "AND comments.post_id = ?" : "";
    const postParams = postId ? [postId] : [];
    return db.prepare(`SELECT comments.*, posts.title AS post_title, posts.topic_id, posts.work_id, saves.target_id AS viewer_saved FROM comments JOIN posts ON posts.id = comments.post_id LEFT JOIN saves ON saves.target_type = 'comment' AND saves.target_id = comments.id AND saves.user_id = ? WHERE posts.withdrawn_at IS NULL ${postClause} ${where} ORDER BY comments.created_at ASC`).all(userId, ...postParams, ...params).map(serializeComment);
  }
  function topicView(request, topic) { const userId = viewer(request)?.id ?? ""; return { ...topic, is_following: Boolean(db.prepare("SELECT 1 FROM topic_follows WHERE topic_id = ? AND user_id = ?").get(topic.id, userId)), is_saved: Boolean(db.prepare("SELECT 1 FROM saves WHERE target_type = 'topic' AND target_id = ? AND user_id = ?").get(topic.id, userId)) }; }
  function toggleSaved(user, targetType, targetId) { const existing = db.prepare("SELECT 1 FROM saves WHERE target_type = ? AND target_id = ? AND user_id = ?").get(targetType, targetId, user.id); if (existing) { db.prepare("DELETE FROM saves WHERE target_type = ? AND target_id = ? AND user_id = ?").run(targetType, targetId, user.id); return false; } db.prepare("INSERT INTO saves (target_type, target_id, user_id, created_at) VALUES (?, ?, ?, ?)").run(targetType, targetId, user.id, new Date().toISOString()); return true; }
  function ownedDraft(request, reply, draftId) {
    const user = requireUser(request, reply);
    if (!user) return null;
    const draft = db.prepare("SELECT * FROM drafts WHERE id = ? AND discarded_at IS NULL").get(draftId);
    if (!draft || (!draft.is_saved && draft.expires_at && new Date(draft.expires_at) < new Date())) { reply.code(410).send({ error: "DRAFT_EXPIRED", message: "这份上下文草稿已过期，请回到 Liteasy 重新发起。" }); return null; }
    if (draft.owner_id !== user.id) { reply.code(403).send({ error: "DRAFT_FORBIDDEN" }); return null; }
    return { draft, user };
  }
  function attachTags(postId, names) {
    for (const name of normalizeTags(names)) {
      const slug = tagSlug(name);
      db.prepare("INSERT OR IGNORE INTO tags (id, slug, name) VALUES (?, ?, ?)").run(randomUUID(), slug, name);
      const tag = db.prepare("SELECT id FROM tags WHERE slug = ?").get(slug);
      db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(postId, tag.id);
    }
  }

  function createContextualDraft(user, value, update) {
    const now = new Date();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const draftUpdate = update ?? {};
    db.prepare("INSERT INTO drafts (id, work_id, topic_id, page, excerpt, anchor_hash, language, owner_id, body, title, tags_json, citation_enabled, is_saved, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
      .run(
        id, value.workId ?? null, value.topicId, value.page ?? null, value.excerpt ?? null,
        value.anchorHash ?? null, value.language, user.id, draftUpdate.body ?? "",
        draftUpdate.title ?? null, JSON.stringify(normalizeTags(draftUpdate.tags ?? [])),
        (draftUpdate.citationEnabled ?? value.citationEnabled) ? 1 : 0,
        now.toISOString(), now.toISOString(), expiresAt
      );
    return { draftId: id, expiresAt };
  }

  function contextualDraftError(value) {
    if (!db.prepare("SELECT id FROM topics WHERE id = ?").get(value.topicId)) {
      return "TOPIC_NOT_FOUND";
    }
    if (value.workId) {
      const work = db.prepare("SELECT id, topic_id FROM works WHERE id = ?").get(value.workId);
      if (!work || work.topic_id !== value.topicId) return "WORK_NOT_FOUND";
    }
    return null;
  }

  app.get("/health", async () => ({ ok: true, service: "intuecho-api" }));
  app.post("/v1/integrations/desktop/draft-handoffs", async (request, reply) => {
    const user = requireDesktopUser(request, reply); if (!user) return;
    const parsed = desktopDraftHandoffSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_HANDOFF", issues: parsed.error.issues });
    const contextError = contextualDraftError(parsed.data.context);
    if (contextError) return reply.code(404).send({ error: contextError });
    const now = new Date();
    const handoffId = randomUUID();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO desktop_draft_handoffs(id, owner_id, context_json, update_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(handoffId, user.id, JSON.stringify(parsed.data.context), parsed.data.update ? JSON.stringify(parsed.data.update) : null, now.toISOString(), expiresAt);
    return reply.code(201).send({ expiresAt, handoffId });
  });
  app.post("/v1/draft-handoffs/:handoffId/consume", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const result = db.transaction(() => {
      const handoff = db.prepare("SELECT * FROM desktop_draft_handoffs WHERE id = ?").get(request.params.handoffId);
      if (!handoff) return { error: "HANDOFF_NOT_FOUND", status: 404 };
      if (handoff.owner_id !== user.id) return { error: "HANDOFF_FORBIDDEN", status: 403 };
      if (handoff.consumed_at) return { draftId: handoff.draft_id, replayed: true };
      if (Date.parse(handoff.expires_at) <= Date.now()) return { error: "HANDOFF_EXPIRED", status: 410 };
      const context = JSON.parse(handoff.context_json);
      const contextError = contextualDraftError(context);
      if (contextError) return { error: contextError, status: 404 };
      const created = createContextualDraft(user, context, handoff.update_json ? JSON.parse(handoff.update_json) : undefined);
      db.prepare("UPDATE desktop_draft_handoffs SET consumed_at = ?, draft_id = ? WHERE id = ?")
        .run(new Date().toISOString(), created.draftId, handoff.id);
      return { ...created, replayed: false };
    })();
    if (result.error) return reply.code(result.status).send({ error: result.error });
    return result;
  });
  app.post("/v1/thin-reading/recommendations:query", async (request, reply) => {
    if (!requireDesktopUser(request, reply)) return;
    const parsed = communityRecommendationQuerySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_RECOMMENDATION_SCOPE", issues: parsed.error.issues });
    return { recommendations: await annotationCommunity.communityRecommendations(parsed.data.scope, request.intuechoDesktopUser) };
  });
  app.get("/v1/admin/posts", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return {
      posts: db.prepare(`
        SELECT id, topic_id, title, body, author_id, author_name, created_at, withdrawn_at
        FROM posts ORDER BY created_at DESC, id LIMIT 200
      `).all()
    };
  });
  app.post("/v1/admin/posts/:postId/moderate", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const action = request.body?.action;
    const reason = String(request.body?.reason ?? "").trim();
    if (!["withdraw", "restore"].includes(action) || reason.length < 3 || reason.length > 1000) {
      return reply.code(400).send({
        error: "INVALID_MODERATION_ACTION",
        message: "请选择治理动作并填写 3–1000 字符的原因。",
        traceId: request.id
      });
    }
    const post = db.prepare("SELECT id, withdrawn_at FROM posts WHERE id = ?").get(request.params.postId);
    if (!post) {
      return reply.code(404).send({
        error: "POST_NOT_FOUND",
        message: "找不到目标帖子。",
        traceId: request.id
      });
    }
    const timestamp = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE posts SET withdrawn_at = ? WHERE id = ?")
        .run(action === "withdraw" ? (post.withdrawn_at ?? timestamp) : null, post.id);
      db.prepare(`
        INSERT INTO moderation_audit (id, post_id, action, reason, admin_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), post.id, action, reason, admin.id, timestamp);
    })();
    return { action, ok: true, postId: post.id };
  });
  app.get("/v1/topics", async (request) => db.prepare("SELECT * FROM topics ORDER BY follower_count DESC").all().map((topic) => topicView(request, topic)));
  app.post("/v1/topics", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const parsed = createTopicSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_TOPIC", issues: parsed.error.issues });
    const value = parsed.data; const id = `${tagSlug(value.name)}-${randomUUID().slice(0, 8)}`;
    db.prepare("INSERT INTO topics VALUES (?, ?, ?, ?, ?)").run(id, value.name, value.description, "由社区成员创建，等待更多阅读与校正。", 0);
    return reply.code(201).send({ topic: db.prepare("SELECT * FROM topics WHERE id = ?").get(id) });
  });
  app.get("/v1/topics/:topicId", async (request, reply) => {
    const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(request.params.topicId); if (!topic) return reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
    const works = db.prepare("SELECT * FROM works WHERE topic_id = ? ORDER BY year DESC").all(topic.id);
    return { topic: topicView(request, topic), works, posts: visiblePosts(request, "AND posts.topic_id = ?", [topic.id]) };
  });
  app.post("/v1/topics/:topicId/follow", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const topic = db.prepare("SELECT id FROM topics WHERE id = ?").get(request.params.topicId); if (!topic) return reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
    const existing = db.prepare("SELECT 1 FROM topic_follows WHERE topic_id = ? AND user_id = ?").get(topic.id, user.id);
    if (existing) { db.prepare("DELETE FROM topic_follows WHERE topic_id = ? AND user_id = ?").run(topic.id, user.id); db.prepare("UPDATE topics SET follower_count = MAX(0, follower_count - 1) WHERE id = ?").run(topic.id); } else { db.prepare("INSERT INTO topic_follows (topic_id, user_id, created_at) VALUES (?, ?, ?)").run(topic.id, user.id, new Date().toISOString()); db.prepare("UPDATE topics SET follower_count = follower_count + 1 WHERE id = ?").run(topic.id); }
    const updated = db.prepare("SELECT follower_count FROM topics WHERE id = ?").get(topic.id); return { following: !existing, followerCount: updated.follower_count };
  });
  app.post("/v1/topics/:topicId/save", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const topic = db.prepare("SELECT id FROM topics WHERE id = ?").get(request.params.topicId); if (!topic) return reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
    return { saved: toggleSaved(user, "topic", topic.id) };
  });
  app.get("/v1/works/:workId", async (request, reply) => {
    const work = db.prepare("SELECT * FROM works WHERE id = ?").get(request.params.workId); if (!work) return reply.code(404).send({ error: "WORK_NOT_FOUND" });
    const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(work.topic_id);
    return { work, topic: topicView(request, topic), posts: visiblePosts(request, "AND posts.work_id = ?", [work.id]) };
  });
  app.post("/v1/drafts/contextual", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const parsed = contextualDraftSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_CONTEXT", issues: parsed.error.issues });
    const contextError = contextualDraftError(parsed.data);
    if (contextError) return reply.code(404).send({ error: contextError });
    return reply.code(201).send(createContextualDraft(user, parsed.data));
  });
  app.get("/v1/drafts/:draftId", async (request, reply) => {
    const result = ownedDraft(request, reply, request.params.draftId); if (!result) return;
    const { draft } = result; const work = draft.work_id ? db.prepare("SELECT * FROM works WHERE id = ?").get(draft.work_id) : null; const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(draft.topic_id);
    return { draft: { ...draft, tags: JSON.parse(draft.tags_json), citation_enabled: Boolean(draft.citation_enabled) }, work, topic };
  });
  app.get("/v1/me/drafts", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const now = new Date().toISOString();
    const rows = db.prepare("SELECT drafts.*, works.title AS work_title, topics.name AS topic_name FROM drafts JOIN topics ON topics.id = drafts.topic_id LEFT JOIN works ON works.id = drafts.work_id WHERE drafts.owner_id = ? AND drafts.discarded_at IS NULL AND drafts.published_post_id IS NULL AND (drafts.is_saved = 1 OR drafts.expires_at >= ?) ORDER BY drafts.updated_at DESC").all(user.id, now);
    return { drafts: rows.map((row) => ({ draft: { ...row, tags: JSON.parse(row.tags_json), citation_enabled: Boolean(row.citation_enabled) }, work: row.work_id ? { id: row.work_id, title: row.work_title } : null, topic: { id: row.topic_id, name: row.topic_name } })) };
  });
  app.get("/v1/me/posts", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    return { posts: visiblePosts(request, "AND posts.author_id = ?", [user.id]) };
  });
  app.get("/v1/me/following", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const topics = db.prepare("SELECT topics.* FROM topics JOIN topic_follows ON topic_follows.topic_id = topics.id WHERE topic_follows.user_id = ? ORDER BY topic_follows.created_at DESC").all(user.id).map((topic) => topicView(request, topic));
    return { topics };
  });
  app.get("/v1/me/saved", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const topics = db.prepare("SELECT topics.* FROM topics JOIN saves ON saves.target_id = topics.id AND saves.target_type = 'topic' WHERE saves.user_id = ? ORDER BY saves.created_at DESC").all(user.id).map((topic) => topicView(request, topic));
    const posts = visiblePosts(request, "AND posts.id IN (SELECT target_id FROM saves WHERE target_type = 'post' AND user_id = ?)", [user.id]);
    const comments = visibleComments(request, null, "AND comments.id IN (SELECT target_id FROM saves WHERE target_type = 'comment' AND user_id = ?)", [user.id]);
    return { topics, posts, comments };
  });
  app.put("/v1/drafts/:draftId", async (request, reply) => {
    const result = ownedDraft(request, reply, request.params.draftId); if (!result) return;
    if (result.draft.published_post_id) return reply.code(409).send({ error: "DRAFT_PUBLISHED" });
    const parsed = updateDraftSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_DRAFT", issues: parsed.error.issues });
    const value = parsed.data; const tags = normalizeTags(value.tags); const updatedAt = new Date().toISOString();
    const topicId = value.topicId ?? result.draft.topic_id;
    if (!db.prepare("SELECT id FROM topics WHERE id = ?").get(topicId)) return reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
    if (value.citationEnabled && (!result.draft.work_id || !result.draft.excerpt || !result.draft.page || !result.draft.anchor_hash)) return reply.code(400).send({ error: "INVALID_CITATION", message: "这份草稿没有可用的原文上下文。" });
    db.prepare("UPDATE drafts SET topic_id = ?, body = ?, title = ?, tags_json = ?, citation_enabled = ?, is_saved = 1, updated_at = ?, expires_at = NULL WHERE id = ?").run(topicId, value.body, value.title ?? null, JSON.stringify(tags), value.citationEnabled ? 1 : 0, updatedAt, result.draft.id);
    return { ok: true, draftId: result.draft.id, updatedAt };
  });
  app.delete("/v1/drafts/:draftId", async (request, reply) => {
    const result = ownedDraft(request, reply, request.params.draftId); if (!result) return;
    if (result.draft.published_post_id) return reply.code(409).send({ error: "DRAFT_PUBLISHED" });
    db.prepare("UPDATE drafts SET discarded_at = ? WHERE id = ?").run(new Date().toISOString(), result.draft.id); return { ok: true, draftId: result.draft.id };
  });
  app.post("/v1/posts", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const parsed = createPostSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_POST", issues: parsed.error.issues });
    const draft = db.prepare("SELECT * FROM drafts WHERE id = ? AND discarded_at IS NULL").get(parsed.data.draftId);
    if (!draft || (!draft.is_saved && draft.expires_at && new Date(draft.expires_at) < new Date())) return reply.code(410).send({ error: "DRAFT_EXPIRED" });
    if (draft.owner_id !== user.id) return reply.code(403).send({ error: "DRAFT_FORBIDDEN" });
    if (!draft.body.trim()) return reply.code(400).send({ error: "DRAFT_EMPTY", message: "请先写下帖子内容。" });
    if (draft.published_post_id) return reply.send({ postId: draft.published_post_id, workId: draft.work_id, topicId: draft.topic_id, replayed: true });
    const citation = draft.citation_enabled ? { page: draft.page, excerpt: draft.excerpt, anchorHash: draft.anchor_hash } : { page: null, excerpt: null, anchorHash: null };
    const post = { ...user, createdAt: new Date().toISOString(), id: randomUUID() };
    const publish = db.transaction(() => { db.prepare("INSERT INTO posts (id, topic_id, work_id, title, body, author_id, author_name, author_initials, page, excerpt, anchor_hash, helpful, misleading, created_at, withdrawn_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL)").run(post.id, draft.topic_id, draft.work_id, draft.title, draft.body, user.id, post.name, post.initials, citation.page, citation.excerpt, citation.anchorHash, post.createdAt); attachTags(post.id, JSON.parse(draft.tags_json)); db.prepare("UPDATE drafts SET published_post_id = ? WHERE id = ?").run(post.id, draft.id); });
    publish(); return reply.code(201).send({ postId: post.id, workId: draft.work_id, topicId: draft.topic_id, replayed: false });
  });
  app.get("/v1/contextual-feed", async (request, reply) => { const { workId, anchorHash } = request.query; if (!workId) return reply.code(400).send({ error: "WORK_ID_REQUIRED" }); const posts = visiblePosts(request, "AND posts.work_id = ?", [workId]).sort((a, b) => Number(b.anchor_hash === anchorHash) - Number(a.anchor_hash === anchorHash) || b.helpful - a.helpful).slice(0, 3); return { posts }; });
  app.get("/v1/search", async (request) => { const query = String(request.query.query ?? "").trim(); const tag = normalizeTag(String(request.query.tag ?? "")); const params = []; const clauses = ["posts.withdrawn_at IS NULL"]; if (query) { clauses.push("(posts.body LIKE ? OR COALESCE(posts.title, '') LIKE ? OR topics.name LIKE ?)"); params.push(`%${query}%`, `%${query}%`, `%${query}%`); } if (tag) { clauses.push("EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = posts.id AND t.slug = ?)"); params.push(tagSlug(tag)); } const userId = viewer(request)?.id ?? ""; const rows = db.prepare(`SELECT posts.*, topics.name AS topic_name, works.title AS work_title, signals.signal AS viewer_signal, saves.target_id AS viewer_saved FROM posts JOIN topics ON topics.id = posts.topic_id LEFT JOIN works ON works.id = posts.work_id LEFT JOIN post_signals signals ON signals.post_id = posts.id AND signals.user_id = ? LEFT JOIN saves ON saves.target_type = 'post' AND saves.target_id = posts.id AND saves.user_id = ? WHERE ${clauses.join(" AND ")} ORDER BY posts.helpful DESC, posts.created_at DESC LIMIT 30`).all(userId, userId, ...params).map((row) => serializePost(row, request)); return { posts: rows, query, tag }; });
  app.post("/v1/posts/:postId/signals", async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const parsed = signalSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_SIGNAL" }); const post = db.prepare("SELECT * FROM posts WHERE id = ? AND withdrawn_at IS NULL").get(request.params.postId); if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" }); const nextSignal = parsed.data.signal; const previous = db.prepare("SELECT signal FROM post_signals WHERE post_id = ? AND user_id = ?").get(post.id, user.id); const toggle = db.transaction(() => { if (previous?.signal === nextSignal) { db.prepare("DELETE FROM post_signals WHERE post_id = ? AND user_id = ?").run(post.id, user.id); db.prepare(`UPDATE posts SET ${nextSignal} = MAX(0, ${nextSignal} - 1) WHERE id = ?`).run(post.id); return null; } if (previous) db.prepare(`UPDATE posts SET ${previous.signal} = MAX(0, ${previous.signal} - 1) WHERE id = ?`).run(post.id); db.prepare("INSERT INTO post_signals (post_id, user_id, signal, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(post_id, user_id) DO UPDATE SET signal = excluded.signal, created_at = excluded.created_at").run(post.id, user.id, nextSignal, new Date().toISOString()); db.prepare(`UPDATE posts SET ${nextSignal} = ${nextSignal} + 1 WHERE id = ?`).run(post.id); return nextSignal; }); const selectedSignal = toggle(); const updated = db.prepare("SELECT helpful FROM posts WHERE id = ?").get(post.id); return { ok: true, helpful: updated.helpful, selectedSignal }; });
  app.post("/v1/posts/:postId/save", async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const post = db.prepare("SELECT id FROM posts WHERE id = ? AND withdrawn_at IS NULL").get(request.params.postId); if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" }); return { saved: toggleSaved(user, "post", post.id) }; });
  app.get("/v1/posts/:postId/comments", async (request, reply) => { const post = db.prepare("SELECT id FROM posts WHERE id = ? AND withdrawn_at IS NULL").get(request.params.postId); if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" }); return { comments: visibleComments(request, post.id) }; });
  app.post("/v1/posts/:postId/comments", async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const post = db.prepare("SELECT id FROM posts WHERE id = ? AND withdrawn_at IS NULL").get(request.params.postId); if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" }); const body = String(request.body?.body ?? "").trim(); if (body.length < 1 || body.length > 2000) return reply.code(400).send({ error: "INVALID_COMMENT", message: "评论需在 1 到 2000 字之间。" }); const comment = { id: `comment-${randomUUID()}`, post_id: post.id, body, author_id: user.id, author_name: user.name, author_initials: user.initials, created_at: new Date().toISOString() }; db.prepare("INSERT INTO comments (id, post_id, body, author_id, author_name, author_initials, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(comment.id, comment.post_id, comment.body, comment.author_id, comment.author_name, comment.author_initials, comment.created_at); return reply.code(201).send({ comment: serializeComment(comment) }); });
  app.post("/v1/comments/:commentId/save", async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const comment = db.prepare("SELECT comments.id FROM comments JOIN posts ON posts.id = comments.post_id WHERE comments.id = ? AND posts.withdrawn_at IS NULL").get(request.params.commentId); if (!comment) return reply.code(404).send({ error: "COMMENT_NOT_FOUND" }); return { saved: toggleSaved(user, "comment", comment.id) }; });
  app.delete("/v1/posts/:postId", async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(request.params.postId); if (!post || post.withdrawn_at) return reply.code(404).send({ error: "POST_NOT_FOUND" }); if (post.author_id !== user.id) return reply.code(403).send({ error: "NOT_POST_AUTHOR", message: "只能撤回自己的公开内容。" }); db.prepare("UPDATE posts SET withdrawn_at = ? WHERE id = ?").run(new Date().toISOString(), post.id); return { ok: true, postId: post.id }; });
  app.post("/v1/feedback", async (request, reply) => { const parsed = createFeedbackSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_FEEDBACK", issues: parsed.error.issues }); const value = parsed.data; db.prepare("INSERT INTO feedback VALUES (?, ?, ?, ?, ?)").run(randomUUID(), value.kind, value.message, value.context ?? null, new Date().toISOString()); return reply.code(201).send({ ok: true }); });
  return { app, db, storage };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { const { app } = await createIntuechoApp(); await app.listen({ port: Number(process.env.INTUECHO_API_PORT ?? 4040), host: "127.0.0.1" }); }
