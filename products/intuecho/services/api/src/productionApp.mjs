import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  desktopCommunityAnnotationBatchSchema,
  communityRecommendationQuerySchema,
  contextualDraftSchema,
  createFeedbackSchema,
  createPostSchema,
  createTopicSchema,
  desktopDraftHandoffSchema,
  signalSchema,
  updateDraftSchema
} from "@intuecho/contracts";
import { ForumRepositoryError, forumText } from "./postgresForumRepository.mjs";
import {
  initialsFor,
  ProductionIdentityError,
  requireFreshAdminMfa
} from "./productionIdentity.mjs";
import { publicIntuechoIdentityConfig } from "./productionConfig.mjs";
import { registerAnnotationCommunityRoutes } from "./annotationCommunityRoutes.mjs";

function user(request) {
  return request.intuechoUser ?? null;
}

function requireUser(request) {
  const current = user(request);
  if (!current) throw new ForumRepositoryError("AUTH_REQUIRED", 401);
  return current;
}

function requireDesktopUser(request) {
  if (!request.intuechoDesktopUser) throw new ForumRepositoryError("DESKTOP_AUTH_REQUIRED", 401);
  return request.intuechoDesktopUser;
}

function requireAdmin(request) {
  if (!request.intuechoAdmin) throw new ProductionIdentityError("authentication_required");
  return requireFreshAdminMfa(request.intuechoAdmin);
}

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

function validated(schema, value, code) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ForumRepositoryError(code);
  return result.data;
}

function errorMessage(code) {
  const messages = {
    access_token_audience_mismatch: "当前会话不适用于 Intuecho。",
    access_token_invalid: "登录会话无效，请重新登录。",
    admin_authorization_unavailable: "管理授权服务暂时不可用，请稍后重试。",
    authentication_required: "请先登录管理员账号。",
    AUTH_REQUIRED: "登录后才能进行此操作。",
    DRAFT_EMPTY: "请先写下帖子内容。",
    DRAFT_EXPIRED: "这份上下文草稿已过期，请回到 Liteasy 重新发起。",
    DRAFT_FORBIDDEN: "这份草稿不属于当前账号。",
    DRAFT_PUBLISHED: "这份草稿已经发布。",
    DESKTOP_AUTH_REQUIRED: "需要 Liteasy 桌面会话。",
    fresh_authentication_required: "请重新完成管理员认证后再操作。",
    identity_service_unavailable: "身份服务暂时不可用，请稍后重试。",
    HANDOFF_EXPIRED: "这次 Liteasy 草稿交接已过期，请返回桌面重新发起。",
    HANDOFF_FORBIDDEN: "这次草稿交接不属于当前账号。",
    HANDOFF_NOT_FOUND: "找不到这次 Liteasy 草稿交接。",
    INVALID_ANNOTATIONS: "公开批注数据不符合要求。",
    INVALID_HANDOFF: "Liteasy 草稿交接数据不符合要求。",
    INVALID_RECOMMENDATION_SCOPE: "社区推荐范围不符合要求。",
    INVALID_CITATION: "这份草稿没有可用的原文上下文。",
    INVALID_ACCOUNT_LIFECYCLE: "账号生命周期请求不符合要求。",
    INVALID_COMMENT: "评论需在 1 到 2000 字之间。",
    INVALID_CONTEXT: "论文上下文不完整，请返回 Liteasy 重试。",
    INVALID_DRAFT: "草稿内容不符合要求。",
    INVALID_FEEDBACK: "反馈内容不符合要求。",
    INVALID_MODERATION_ACTION: "请选择治理动作并填写 3–1000 字符的原因。",
    INVALID_POST: "发布请求不符合要求。",
    INVALID_SIGNAL: "请选择有效的评价。",
    INVALID_TOPIC: "主题名称或说明不符合要求。",
    mfa_required: "此管理操作需要多因素认证。",
    NOT_POST_AUTHOR: "只能撤回自己的公开内容。",
    platform_admin_required: "需要平台管理员权限。",
    POST_NOT_FOUND: "找不到目标帖子。",
    session_revoked: "登录会话已经结束，请重新登录。",
    TOPIC_NOT_FOUND: "找不到目标研究主题。",
    WORK_ID_REQUIRED: "缺少论文标识。",
    WORK_NOT_FOUND: "找不到目标论文。"
  };
  return messages[code] ?? "请求未能完成，请稍后重试。";
}

function knownError(error) {
  return error instanceof ForumRepositoryError || error instanceof ProductionIdentityError;
}

export async function createProductionIntuechoApp(runtime, config, { logger = false } = {}) {
  const app = Fastify({ bodyLimit: 1024 * 1024, logger });
  await app.register(cors, {
    allowedHeaders: ["authorization", "content-type", "idempotency-key"],
    methods: ["DELETE", "GET", "POST", "PUT"],
    origin: config.allowedOrigins
  });
  app.decorateRequest("intuechoAdmin", null);
  app.decorateRequest("intuechoDesktopUser", null);
  app.decorateRequest("intuechoUser", null);

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return payload;
  });

  app.addHook("preHandler", async (request) => {
    const authorization = request.headers.authorization;
    if (!authorization) return;
    if (request.url.startsWith("/v1/admin/")) {
      const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
        authorization,
        "liteasy-admin"
      );
      await runtime.adminAuthorizer.assertPlatformAdmin(identity);
      request.intuechoAdmin = identity;
      return;
    }
    if (isDesktopIntegrationRequest(request)) {
      const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
        authorization,
        "liteasy-desktop"
      );
      request.intuechoDesktopUser = Object.freeze({
        id: identity.subject,
        initials: initialsFor(identity.name),
        name: identity.name
      });
      return;
    }
    const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
      authorization,
      "intuecho-web"
    );
    request.intuechoUser = Object.freeze({
      id: identity.subject,
      initials: initialsFor(identity.name),
      name: identity.name
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const known = knownError(error);
    const code = known ? error.code : "INTERNAL_ERROR";
    const status = known ? error.status : 500;
    if (!known) request.log.error({ err: error, traceId: request.id }, "Intuecho request failed");
    reply.code(status).send({ code, message: errorMessage(code), traceId: request.id });
  });

  app.get("/health", async () => ({ ok: true, service: "intuecho-api" }));
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({
    deployment: {
      database: "postgresql",
      databaseTls: config.database.sslMode,
      environment: config.environment,
      identity: "oidc+jwks+rfc7662",
      sessionAudience: "intuecho-web"
    },
    readiness: runtime.readiness,
    status: "ready"
  }));
  app.get("/v1/identity/web-config", async () => publicIntuechoIdentityConfig(config));

  if (runtime.annotationCommunityRepository) {
    registerAnnotationCommunityRoutes(app, runtime.annotationCommunityRepository, {
      currentUser: user,
      requireAdmin,
      requireDesktopUser,
      requireUser
    });
  }

  app.post("/v1/integrations/desktop/draft-handoffs", async (request, reply) => {
    const current = requireDesktopUser(request);
    const value = validated(desktopDraftHandoffSchema, request.body, "INVALID_HANDOFF");
    return reply.code(201).send(await runtime.repository.createDraftHandoff(current.id, value));
  });
  app.post("/v1/draft-handoffs/:handoffId/consume", async (request) =>
    runtime.repository.consumeDraftHandoff(request.params.handoffId, requireUser(request).id));
  for (const route of ["/v1/pdf-annotations:sync", "/v1/thin-reading/annotations:sync"]) {
    app.post(route, async (request) => {
      const value = validated(desktopCommunityAnnotationBatchSchema, request.body, "INVALID_ANNOTATIONS");
      return {
        results: await runtime.annotationCommunityRepository.syncDesktopAnnotations(
          requireDesktopUser(request),
          value.annotations
        )
      };
    });
  }
  app.post("/v1/thin-reading/recommendations:query", async (request) => {
    const value = validated(
      communityRecommendationQuerySchema,
      request.body,
      "INVALID_RECOMMENDATION_SCOPE"
    );
    const viewer = requireDesktopUser(request);
    return { recommendations: await runtime.annotationCommunityRepository.communityRecommendations(value.scope, viewer) };
  });

  app.get("/v1/admin/posts", async (request) => {
    if (!request.intuechoAdmin) throw new ProductionIdentityError("authentication_required");
    return { posts: await runtime.repository.listAdminPosts() };
  });
  app.post("/v1/admin/posts/:postId/moderate", async (request) => {
    if (!request.intuechoAdmin) throw new ProductionIdentityError("authentication_required");
    const admin = requireFreshAdminMfa(request.intuechoAdmin);
    return runtime.repository.moderatePost({
      action: request.body?.action,
      adminId: admin.subject,
      postId: request.params.postId,
      reason: request.body?.reason,
      traceId: request.id
    });
  });
  app.post("/v1/admin/accounts/:subjectId/delete", async (request) => {
    if (!request.intuechoAdmin) throw new ProductionIdentityError("authentication_required");
    const admin = requireFreshAdminMfa(request.intuechoAdmin);
    return runtime.accountLifecycleRepository.deleteAccount({
      idempotencyKey: request.body?.idempotencyKey,
      reason: request.body?.reason,
      requestedBy: admin.subject,
      subjectId: request.params.subjectId,
      traceId: request.id
    });
  });

  app.get("/v1/topics", async (request) => runtime.repository.listTopics(user(request)?.id));
  app.post("/v1/topics", async (request, reply) => {
    requireUser(request);
    const value = validated(createTopicSchema, request.body, "INVALID_TOPIC");
    return reply.code(201).send({ topic: await runtime.repository.createTopic(value) });
  });
  app.get("/v1/topics/:topicId", async (request) =>
    runtime.repository.topicBundle(request.params.topicId, user(request)?.id));
  app.post("/v1/topics/:topicId/follow", async (request) =>
    runtime.repository.toggleFollow(request.params.topicId, requireUser(request).id));
  app.post("/v1/topics/:topicId/save", async (request) =>
    runtime.repository.toggleSave("topic", request.params.topicId, requireUser(request).id));

  app.get("/v1/works/:workId", async (request) =>
    runtime.repository.workBundle(request.params.workId, user(request)?.id));

  app.post("/v1/drafts/contextual", async (request, reply) => {
    const current = requireUser(request);
    const value = validated(contextualDraftSchema, request.body, "INVALID_CONTEXT");
    return reply.code(201).send(await runtime.repository.createContextualDraft(current.id, value));
  });
  app.get("/v1/drafts/:draftId", async (request) =>
    runtime.repository.draftBundle(request.params.draftId, requireUser(request).id));
  app.get("/v1/me/drafts", async (request) => ({
    drafts: await runtime.repository.listDrafts(requireUser(request).id)
  }));
  app.get("/v1/me/posts", async (request) => {
    const current = requireUser(request);
    return { posts: await runtime.repository.listPosts(current.id, { authorId: current.id }) };
  });
  app.get("/v1/me/following", async (request) => ({
    topics: await runtime.repository.listFollowing(requireUser(request).id)
  }));
  app.get("/v1/me/saved", async (request) =>
    runtime.repository.listSaved(requireUser(request).id));
  app.put("/v1/drafts/:draftId", async (request) => {
    const value = validated(updateDraftSchema, request.body, "INVALID_DRAFT");
    return runtime.repository.updateDraft(
      request.params.draftId,
      requireUser(request).id,
      value
    );
  });
  app.delete("/v1/drafts/:draftId", async (request) =>
    runtime.repository.discardDraft(request.params.draftId, requireUser(request).id));
  app.post("/v1/posts", async (request, reply) => {
    const value = validated(createPostSchema, request.body, "INVALID_POST");
    return reply.code(201).send(await runtime.repository.publishDraft(
      value.draftId,
      requireUser(request)
    ));
  });

  app.get("/v1/contextual-feed", async (request) => {
    const workId = String(request.query.workId ?? "");
    if (!workId) throw new ForumRepositoryError("WORK_ID_REQUIRED");
    return {
      posts: await runtime.repository.contextualFeed(
        workId,
        String(request.query.anchorHash ?? ""),
        user(request)?.id
      )
    };
  });
  app.get("/v1/search", async (request) => {
    const query = String(request.query.query ?? "").trim();
    const tag = forumText.normalizeTag(String(request.query.tag ?? ""));
    return { posts: await runtime.repository.search(query, tag, user(request)?.id), query, tag };
  });
  app.post("/v1/posts/:postId/signals", async (request) => {
    const value = validated(signalSchema, request.body, "INVALID_SIGNAL");
    return runtime.repository.toggleSignal(
      request.params.postId,
      requireUser(request).id,
      value.signal
    );
  });
  app.post("/v1/posts/:postId/save", async (request) =>
    runtime.repository.toggleSave("post", request.params.postId, requireUser(request).id));
  app.get("/v1/posts/:postId/comments", async (request) => ({
    comments: await runtime.repository.listComments(user(request)?.id, {
      postId: request.params.postId
    })
  }));
  app.post("/v1/posts/:postId/comments", async (request, reply) => {
    const comment = await runtime.repository.createComment(
      request.params.postId,
      requireUser(request),
      request.body?.body
    );
    return reply.code(201).send({ comment });
  });
  app.post("/v1/comments/:commentId/save", async (request) =>
    runtime.repository.toggleSave("comment", request.params.commentId, requireUser(request).id));
  app.delete("/v1/posts/:postId", async (request) =>
    runtime.repository.withdrawPost(request.params.postId, requireUser(request).id));
  app.post("/v1/feedback", async (request, reply) => {
    const value = validated(createFeedbackSchema, request.body, "INVALID_FEEDBACK");
    await runtime.repository.createFeedback(value, user(request)?.id);
    return reply.code(201).send({ ok: true });
  });

  return app;
}
