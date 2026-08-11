import {
  academicProfileSchema,
  annotationRatingSchema,
  annotationModerationSchema,
  createAnnotationSchema,
  createConversationSchema,
  createReplySchema,
  desktopAnnotationHandoffSchema,
  desktopAnnotationPublicationBatchSchema,
  desktopCommunityAnnotationBatchSchema,
  followUserSchema,
  markConversationReadSchema,
  sendMessageSchema,
  tagAppealSchema,
  tagAppealResolutionSchema,
  updateAnnotationSchema,
  updateReplyPublicationSchema,
  updateReplySchema
} from "@intuecho/contracts";
import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

function validated(schema, value, code) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AnnotationCommunityError(code);
  return parsed.data;
}

function plazaFilters(query = {}) {
  const limit = Number(query.limit ?? 30);
  const sort = query.sort === "recommended" ? "recommended" : "latest";
  const literatureIdentityKind = String(query.literatureIdentityKind ?? "");
  const literatureIdentityValue = String(query.literatureIdentityValue ?? "").trim();
  const literatureId = String(query.literatureId ?? "").trim();
  if (literatureIdentityValue && !new Set([
    "doi",
    "arxiv_id",
    "semantic_scholar_id",
    "openalex_id",
    "openreview_id",
    "dblp_key",
    "pmlr_id",
    "title_authors_year_hash"
  ]).has(literatureIdentityKind)) {
    throw new AnnotationCommunityError("INVALID_LITERATURE_FILTER");
  }
  return {
    documentType: String(query.documentType ?? "").trim(),
    educationStage: String(query.educationStage ?? "").trim(),
    institution: String(query.institution ?? "").trim(),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 30,
    literatureId: literatureId.slice(0, 200),
    literatureIdentityKind,
    literatureIdentityValue,
    query: String(query.query ?? "").trim(),
    sort
  };
}

const messages = {
  ANNOTATION_NOT_FOUND: "找不到这条批注。",
  ANNOTATION_MODERATION_CONFLICT: "这条批注已经处于目标治理状态。",
  ANNOTATION_SCOPE_LOCKED_BY_REPLIES: "已有回复后不能修改批注的可见范围或所属组织。",
  ANNOTATION_TARGET_REQUIRED: "批注必须关联至少一篇文献或一个文献字句。",
  AUTH_REQUIRED: "登录后才能进行此操作。",
  CANNOT_FOLLOW_SELF: "不能关注自己。",
  CONVERSATION_NOT_FOUND: "找不到这段私聊。",
  DERIVED_BODY_READ_ONLY: "独立批注正文必须通过原回复修改。",
  INVALID_ANNOTATION: "批注内容或关联目标不符合要求。",
  INVALID_ANNOTATION_UPDATE: "批注修改内容不符合要求。",
  INVALID_LITERATURE_FILTER: "文献筛选条件不符合要求。",
  INVALID_MESSAGE: "消息内容不符合要求。",
  INVALID_READ_STATE: "已读位置不符合要求。",
  INVALID_PROFILE: "学术资料不符合要求。",
  INVALID_RATING: "评分必须是 1 到 5 的整数。",
  INVALID_REPLY: "回复内容或关联目标不符合要求。",
  INVALID_REPLY_PUBLICATION: "回复的独立批注设置不符合要求。",
  INVALID_REPLY_UPDATE: "回复修改内容不符合要求。",
  INVALID_TAG_APPEAL: "标签申诉理由不符合要求。",
  INVALID_TAG_APPEAL_RESOLUTION: "标签申诉审核内容不符合要求。",
  INVALID_TAG_APPEAL_STATUS: "标签申诉状态筛选无效。",
  MUTUAL_FOLLOW_REQUIRED: "只有互相关注后才能新建会话或发送消息。",
  NOT_ANNOTATION_AUTHOR: "只能修改自己的批注。",
  NOT_REPLY_AUTHOR: "只能修改自己的回复。",
  ORGANIZATION_ACCESS_DENIED: "当前账号不具备该组织的访问权限。",
  ORGANIZATION_MODERATION_DENIED: "只有当前组织负责人或管理员可以治理这条批注。",
  ORGANIZATION_AUTHORIZATION_UNAVAILABLE: "组织授权服务暂时不可用。",
  ORGANIZATION_INVITATION_DENIED: "当前账号无权发送这份组织邀请。",
  PARENT_ANNOTATION_NOT_FOUND: "找不到要回复的批注。",
  REPLY_NOT_FOUND: "找不到这条回复。",
  SELF_RATING_FORBIDDEN: "不能给自己的批注评分。",
  PLATFORM_TAG_NOT_FOUND: "找不到需要申诉的平台标签。",
  PLATFORM_TAG_APPEAL_NOT_ALLOWED: "这个平台标签已经申诉或完成审核。",
  PLAZA_REQUIRES_PUBLIC_VISIBILITY: "只有公开批注可以进入广场。",
  REPLY_VISIBILITY_MISMATCH: "回复的可见范围必须与原批注一致。",
  TAG_APPEAL_ALREADY_RESOLVED: "这项标签申诉已经完成审核。",
  TAG_APPEAL_NOT_FOUND: "找不到这项标签申诉。"
};

export function registerAnnotationCommunityRoutes(app, repository, {
  currentUser,
  requireAdmin,
  requireDesktopUser,
  requireUser
}) {
  async function route(reply, operation) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AnnotationCommunityError)) throw error;
      return reply.code(error.status).send({
        code: error.code,
        error: error.code,
        message: messages[error.code] ?? "请求未能完成，请稍后重试。"
      });
    }
  }

  app.get("/v1/plaza", async (request, reply) => route(reply, async () => ({
    annotations: await repository.plaza(currentUser(request), plazaFilters(request.query)),
    filters: plazaFilters(request.query)
  })));

  if (requireDesktopUser) {
    app.post("/v1/integrations/desktop/annotation-handoffs", async (request, reply) => route(reply, async () => {
      const viewer = requireDesktopUser(request, reply);
      if (!viewer) return;
      const input = validated(desktopAnnotationHandoffSchema, request.body, "INVALID_HANDOFF");
      return reply.code(201).send(await repository.createHandoff(viewer.id, input));
    }));

    app.post("/v1/pdf-annotations:sync", async (request, reply) => route(reply, async () => {
      const viewer = requireDesktopUser(request, reply);
      if (!viewer) return;
      const publication = desktopAnnotationPublicationBatchSchema.safeParse(request.body);
      if (publication.success) {
        return { results: await repository.applyDesktopAnnotationPublications(viewer, publication.data.operations) };
      }
      throw new AnnotationCommunityError("INVALID_ANNOTATIONS");
    }));

    app.post("/v1/thin-reading/annotations:sync", async (request, reply) => route(reply, async () => {
      const viewer = requireDesktopUser(request, reply);
      if (!viewer) return;
      const legacy = validated(desktopCommunityAnnotationBatchSchema, request.body, "INVALID_ANNOTATIONS");
      return { results: await repository.syncDesktopAnnotations(viewer, legacy.annotations) };
    }));
  }

  app.post("/v1/annotation-handoffs/:handoffId/consume", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    return viewer ? repository.consumeHandoff(request.params.handoffId, viewer.id) : undefined;
  }));

  app.get("/v1/me/annotations", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    return viewer ? { annotations: await repository.mine(viewer) } : undefined;
  }));

  app.get("/v1/me/following-annotations", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    return viewer ? { annotations: await repository.followingFeed(viewer) } : undefined;
  }));

  app.get("/v1/me/organization-annotations", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    return viewer ? { organizations: await repository.organizationFeed(viewer) } : undefined;
  }));

  app.get("/v1/annotations/:annotationId", async (request, reply) => route(reply, async () => ({
    annotation: await repository.annotation(request.params.annotationId, currentUser(request))
  })));

  app.post("/v1/annotations", async (request, reply) => route(reply, async () => {
    const author = requireUser(request, reply);
    if (!author) return;
    const input = validated(createAnnotationSchema, request.body, "INVALID_ANNOTATION");
    const annotation = await repository.createAnnotation(author, input);
    return reply.code(201).send({ annotation });
  }));

  app.put("/v1/annotations/:annotationId", async (request, reply) => route(reply, async () => {
    const author = requireUser(request, reply);
    if (!author) return;
    const input = validated(updateAnnotationSchema, request.body, "INVALID_ANNOTATION_UPDATE");
    return { annotation: await repository.updateAnnotation(request.params.annotationId, author, input) };
  }));

  app.get("/v1/annotations/:annotationId/replies", async (request, reply) => route(reply, async () => ({
    replies: await repository.replies(request.params.annotationId, currentUser(request))
  })));

  app.put("/v1/annotations/:annotationId/rating", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    if (!viewer) return;
    const input = validated(annotationRatingSchema, request.body, "INVALID_RATING");
    return repository.rateAnnotation(request.params.annotationId, viewer, input.rating);
  }));

  app.post("/v1/annotations/:annotationId/save", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    return viewer ? repository.toggleSave(request.params.annotationId, viewer) : undefined;
  }));

  app.delete("/v1/annotations/:annotationId", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    return viewer ? repository.withdraw(request.params.annotationId, viewer) : undefined;
  }));

  app.post("/v1/annotations/:annotationId/organization-moderation", async (request, reply) => route(reply, async () => {
    const viewer = requireUser(request, reply);
    if (!viewer) return;
    const input = validated(annotationModerationSchema, request.body, "INVALID_ANNOTATION_MODERATION");
    return repository.moderateOrganizationAnnotation({
      ...input,
      annotationId: request.params.annotationId,
      traceId: request.id,
      userId: viewer.id
    });
  }));

  app.post("/v1/annotations/:annotationId/replies", async (request, reply) => route(reply, async () => {
    const author = requireUser(request, reply);
    if (!author) return;
    const input = validated(createReplySchema, request.body, "INVALID_REPLY");
    return reply.code(201).send(await repository.createReply(request.params.annotationId, author, input));
  }));

  app.put("/v1/replies/:replyId", async (request, reply) => route(reply, async () => {
    const author = requireUser(request, reply);
    if (!author) return;
    const input = validated(updateReplySchema, request.body, "INVALID_REPLY_UPDATE");
    return { reply: await repository.updateReply(request.params.replyId, author, input) };
  }));

  app.put("/v1/replies/:replyId/publication", async (request, reply) => route(reply, async () => {
    const author = requireUser(request, reply);
    if (!author) return;
    const input = validated(updateReplyPublicationSchema, request.body, "INVALID_REPLY_PUBLICATION");
    return repository.updateReplyPublication(request.params.replyId, author, input);
  }));

  app.delete("/v1/replies/:replyId", async (request, reply) => route(reply, async () => {
    const author = requireUser(request, reply);
    return author ? repository.deleteReply(request.params.replyId, author) : undefined;
  }));

  app.get("/v1/me/academic-profile", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    return user ? { profile: await repository.profile(user.id) } : undefined;
  }));

  app.put("/v1/me/academic-profile", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { profile: await repository.updateProfile(user.id, validated(academicProfileSchema, request.body, "INVALID_PROFILE")) };
  }));

  app.post("/v1/follows", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = validated(followUserSchema, request.body, "INVALID_FOLLOW");
    return repository.toggleFollow(user.id, input.targetUserId);
  }));

  app.post("/v1/conversations", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = validated(createConversationSchema, request.body, "INVALID_CONVERSATION");
    return reply.code(201).send(await repository.createConversation(user.id, input.participantId));
  }));

  app.get("/v1/conversations", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    return user ? { conversations: await repository.conversations(user.id) } : undefined;
  }));

  app.get("/v1/conversations/:conversationId/messages", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    return user ? { messages: await repository.messages(request.params.conversationId, user.id) } : undefined;
  }));

  app.put("/v1/conversations/:conversationId/read", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = validated(markConversationReadSchema, request.body, "INVALID_READ_STATE");
    return repository.markConversationRead(request.params.conversationId, user.id, input.messageId);
  }));

  app.post("/v1/conversations/:conversationId/messages", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = validated(sendMessageSchema, request.body, "INVALID_MESSAGE");
    return reply.code(201).send({ message: await repository.sendMessage(request.params.conversationId, user.id, input) });
  }));

  app.post("/v1/annotations/:annotationId/tags/:tag/appeals", async (request, reply) => route(reply, async () => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = validated(tagAppealSchema, request.body, "INVALID_TAG_APPEAL");
    return reply.code(201).send(await repository.appealPlatformTag(request.params.annotationId, request.params.tag, user.id, input.reason));
  }));

  if (requireAdmin) {
    app.get("/v1/admin/annotations", async (request, reply) => route(reply, async () => {
      const admin = requireAdmin(request, reply);
      return admin ? { annotations: await repository.listAdminAnnotations() } : undefined;
    }));

    app.post("/v1/admin/annotations/:annotationId/moderate", async (request, reply) => route(reply, async () => {
      const admin = requireAdmin(request, reply);
      if (!admin) return;
      const input = validated(annotationModerationSchema, request.body, "INVALID_ANNOTATION_MODERATION");
      return repository.moderateAnnotation({
        ...input,
        adminId: admin.id ?? admin.subject,
        annotationId: request.params.annotationId,
        traceId: request.id
      });
    }));

    app.get("/v1/admin/annotation-tag-appeals", async (request, reply) => route(reply, async () => {
      const admin = requireAdmin(request, reply);
      if (!admin) return;
      const status = String(request.query?.status ?? "pending");
      if (!["pending", "accepted", "rejected"].includes(status)) throw new AnnotationCommunityError("INVALID_TAG_APPEAL_STATUS");
      return { appeals: await repository.listTagAppeals(status) };
    }));

    app.post("/v1/admin/annotation-tag-appeals/:appealId/resolve", async (request, reply) => route(reply, async () => {
      const admin = requireAdmin(request, reply);
      if (!admin) return;
      const input = validated(tagAppealResolutionSchema, request.body, "INVALID_TAG_APPEAL_RESOLUTION");
      return repository.resolveTagAppeal(request.params.appealId, admin.id ?? admin.subject, input, request.id);
    }));
  }
}
