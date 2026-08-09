import { z } from "zod";

const tagSchema = z.string().trim().min(1).max(32);
const rectangleSchema = z.object({
  height: z.number().finite(),
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite()
}).strict();

export const contextualDraftSchema = z.object({
  topicId: z.string().min(1),
  workId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  excerpt: z.string().min(8).max(2000).optional(),
  anchorHash: z.string().min(8).optional(),
  language: z.string().default("zh-CN"),
  citationEnabled: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.citationEnabled && (!value.workId || !value.page || !value.excerpt || !value.anchorHash)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["citationEnabled"], message: "启用引用时需要完整的论文、页码、摘录和文本指纹。" });
});

export const updateDraftSchema = z.object({
  body: z.string().max(4000),
  tags: z.array(tagSchema).max(5),
  citationEnabled: z.boolean(),
  topicId: z.string().min(1).optional(),
  title: z.string().max(180).optional()
});

export const createPostSchema = z.object({ draftId: z.string().min(1) });
export const createTopicSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().min(8).max(300) });
// Kept for the legacy /v1/posts surface. Community annotations use star ratings.
export const signalSchema = z.object({ signal: z.enum(["helpful", "misleading"]) });
export const annotationRatingSchema = z.object({ rating: z.number().int().min(1).max(5) });
export const createFeedbackSchema = z.object({ kind: z.enum(["bug", "idea", "experience"]), message: z.string().min(8).max(2000), context: z.string().max(300).optional() });

export const paperIdentitySchema = z.object({
  id: z.string().trim().min(1).max(1200),
  kind: z.enum(["doi", "arxiv_id", "semantic_scholar_id", "title_authors_year_hash"]),
  source: z.enum(["inferred", "metadata"]),
  value: z.string().trim().min(1).max(1000)
});

const scopedPaperIdentitySchema = z.object({ primary: paperIdentitySchema }).optional();
const annotationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf_passage"), page: z.number().int().positive(), paperIdentity: scopedPaperIdentitySchema, rects: z.array(rectangleSchema).max(200) }),
  z.object({ kind: z.literal("document"), paperIdentity: scopedPaperIdentitySchema }),
  z.object({ kind: z.literal("section"), paperIdentity: scopedPaperIdentitySchema, sectionKey: z.string().trim().min(1).max(500) }),
  z.object({
    kind: z.literal("selected_passage"),
    evidenceIds: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    externalSourceIds: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    paperIdentity: scopedPaperIdentitySchema
  })
]);

export const communityAnnotationSchema = z.object({
  annotationId: z.string().trim().min(1).max(200),
  artifactId: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(4000),
  createdAt: z.string().datetime(),
  excerpt: z.string().trim().min(1).max(2000),
  nodeId: z.string().trim().min(1).max(200).optional(),
  paperIdentity: z.object({ primary: paperIdentitySchema }).optional(),
  queueKey: z.string().trim().min(1).max(500),
  scope: annotationScopeSchema,
  status: z.literal("pending_public"),
  updatedAt: z.string().datetime()
}).superRefine((value, context) => {
  if (!value.paperIdentity?.primary && !value.scope.paperIdentity?.primary) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["paperIdentity"], message: "社区批注需要稳定论文身份。" });
  }
});

export const communityAnnotationBatchSchema = z.object({
  annotations: z.array(communityAnnotationSchema).min(1).max(100)
});

export const communityRecommendationQuerySchema = z.object({
  scope: z.object({
    kind: z.enum(["document", "section", "selected_passage"]),
    paperIdentity: paperIdentitySchema,
    sectionKey: z.string().trim().min(1).max(500).optional(),
    evidenceIds: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    externalSourceIds: z.array(z.string().trim().min(1).max(500)).max(100).optional()
  })
});

export const desktopDraftHandoffSchema = z.object({
  context: contextualDraftSchema,
  update: updateDraftSchema.partial().optional()
}).superRefine((value, context) => {
  if (value.update?.citationEnabled && (
    !value.context.workId || !value.context.page || !value.context.excerpt || !value.context.anchorHash
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["update", "citationEnabled"],
      message: "启用引用时需要完整的论文、页码、摘录和文本指纹。"
    });
  }
});

export const annotationVisibilitySchema = z.enum([
  "private",
  "organization",
  "mutual_followers",
  "public"
]);

export const literatureIdentifierKindSchema = z.enum([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id",
  "title_authors_year_hash"
]);

export const literatureSourceSchema = z.enum(["public_registry", "manual", "inferred"]);

export const literatureIdentifierSchema = z.object({
  kind: literatureIdentifierKindSchema,
  source: literatureSourceSchema,
  value: z.string().trim().min(1).max(1000)
});

const literatureDisplaySchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(literatureIdentifierSchema).max(20),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
});

const literatureProviderSchema = z.enum(["intuecho", "openalex", "crossref", "arxiv", "semantic_scholar"]);

export const literatureCandidateSchema = z.object({
  candidateKey: z.string().trim().min(1).max(1000),
  provider: literatureProviderSchema,
  record: literatureDisplaySchema,
  recordUrl: z.string().url().refine((value) => new URL(value).protocol === "https:").optional()
});

const manualLiteratureIdentifierSchema = z.object({
  kind: z.enum(["doi", "arxiv_id", "semantic_scholar_id", "openalex_id"]),
  source: z.literal("manual"),
  value: z.string().trim().min(1).max(1000)
}).strict();

export const manualLiteratureInputSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(manualLiteratureIdentifierSchema).max(20),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
}).strict().superRefine((value, context) => {
  if (value.identifiers.length === 0 && (value.authors.length === 0 || !value.year)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "手动文献需要稳定标识，或完整的标题、作者和年份。"
    });
  }
});

export const literatureRecordSchema = z.object({
  ...literatureDisplaySchema.shape,
  identifiers: z.array(literatureIdentifierSchema).min(1).max(20),
  literatureId: z.string().trim().min(1).max(200),
  provenance: z.object({
    confirmedAt: z.string().datetime(),
    mode: z.enum(["public_registry", "manual"]),
    provider: literatureProviderSchema.optional()
  })
}).superRefine((value, context) => {
  if (value.identifiers.some((identifier) => identifier.source !== value.provenance.mode)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identifiers"],
      message: "文献标识来源必须与确认来源一致。"
    });
  }
});

const literatureResolveHintsSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
  identifiers: z.array(z.object({
    kind: literatureIdentifierKindSchema,
    value: z.string().trim().min(1).max(1000)
  }).strict()).max(20).optional(),
  title: z.string().trim().min(1).max(1000).optional(),
  year: z.number().int().min(1000).max(9999).optional()
}).strict();

export const literatureResolveInputSchema = z.object({
  hints: literatureResolveHintsSchema.optional(),
  limit: z.number().int().min(1).max(10).optional(),
  purpose: z.enum(["forum_compose", "liteasy_pdf_annotation"]),
  query: z.string().trim().min(1).max(1000).optional()
}).strict().superRefine((value, context) => {
  const hints = value.hints;
  const hasUsableHint = Boolean(
    hints?.title || hints?.year || hints?.authors?.length || hints?.identifiers?.length
  );
  if (!value.query && !hasUsableHint) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "文献检索需要查询文本或至少一个书目提示。"
    });
  }
});

export const literatureConfirmInputSchema = z.discriminatedUnion("mode", [
  z.object({
    candidateKey: z.string().trim().min(1).max(1000),
    mode: z.literal("candidate")
  }).strict(),
  z.object({
    mode: z.literal("manual"),
    record: manualLiteratureInputSchema
  }).strict()
]);

export const literatureMetadataSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200).default([]),
  documentType: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
});

const legacyLiteratureReferenceSchema = z.object({
  identity: paperIdentitySchema,
  metadata: literatureMetadataSchema
}).strict();

export const confirmedLiteratureReferenceSchema = z.object({
  literatureId: z.string().trim().min(1).max(200)
}).strict();

export const literatureReferenceSchema = z.union([
  confirmedLiteratureReferenceSchema,
  legacyLiteratureReferenceSchema
]);

const sourceEvidenceSchema = z.object({
  anchorHash: z.string().trim().min(8).max(500),
  excerpt: z.string().trim().min(1).max(4000),
  literature: literatureReferenceSchema,
  page: z.number().int().positive().optional(),
  rects: z.array(rectangleSchema).max(200).default([])
});

export const annotationTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("whole_document"),
    literature: literatureReferenceSchema
  }),
  sourceEvidenceSchema.extend({ kind: z.literal("source_passage") }),
  z.object({
    derivedContent: z.object({
      artifactId: z.string().trim().min(1).max(200),
      excerpt: z.string().trim().min(1).max(4000),
      nodeId: z.string().trim().min(1).max(200).optional(),
      version: z.string().trim().min(1).max(200)
    }),
    evidence: z.array(sourceEvidenceSchema).min(1).max(100),
    kind: z.literal("derived_passage"),
    literature: literatureReferenceSchema
  })
]);

const annotationTagsSchema = z.array(tagSchema).max(20).default([]);

export const createAnnotationSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  organizationId: z.string().trim().min(1).max(200).optional(),
  shareToPlaza: z.boolean().default(true),
  tags: annotationTagsSchema,
  targets: z.array(annotationTargetSchema).min(1).max(100),
  visibility: annotationVisibilitySchema.default("public")
}).superRefine((value, context) => {
  if (value.shareToPlaza && value.visibility !== "public") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["shareToPlaza"], message: "只有公开批注可以进入广场。" });
  }
  if (value.visibility === "organization" && !value.organizationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organizationId"], message: "组织可见批注必须指定组织。" });
  }
  if (value.visibility !== "organization" && value.organizationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organizationId"], message: "只有组织可见批注可以指定组织。" });
  }
});

export const updateAnnotationSchema = z.object({
  body: z.string().trim().min(1).max(8000).optional(),
  organizationId: z.string().trim().min(1).max(200).nullable().optional(),
  shareToPlaza: z.boolean().optional(),
  tags: annotationTagsSchema.optional(),
  targets: z.array(annotationTargetSchema).min(1).max(100).optional(),
  visibility: annotationVisibilitySchema.optional()
}).refine((value) => Object.keys(value).length > 0, "至少提供一项修改。");

export const academicProfileSchema = z.object({
  educationStage: z.string().trim().min(1).max(100).nullable().default(null),
  institutions: z.array(z.object({
    name: z.string().trim().min(1).max(300)
  })).max(20).default([])
});

export const createReplySchema = z.object({
  body: z.string().trim().min(1).max(8000),
  shareToPlaza: z.boolean().default(true),
  tags: annotationTagsSchema,
  targets: z.array(annotationTargetSchema).max(100).default([])
}).superRefine((value, context) => {
  if (value.shareToPlaza && value.targets.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "只有关联文献的回复才能同时发布为批注。" });
  }
});

export const updateReplySchema = z.object({
  body: z.string().trim().min(1).max(8000)
});

export const followUserSchema = z.object({
  targetUserId: z.string().trim().min(1).max(200)
});

export const createConversationSchema = z.object({
  participantId: z.string().trim().min(1).max(200)
});

export const markConversationReadSchema = z.object({
  messageId: z.string().trim().min(1).max(200)
});

export const sendMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    body: z.string().trim().min(1).max(4000),
    kind: z.literal("text")
  }),
  z.object({
    body: z.string().trim().max(4000).default(""),
    invitation: z.object({
      organizationId: z.string().trim().min(1).max(200),
      role: z.string().trim().min(1).max(100)
    }),
    kind: z.literal("organization_invitation")
  })
]);

export const tagAppealSchema = z.object({
  reason: z.string().trim().min(8).max(2000)
});

export const tagAppealResolutionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  reason: z.string().trim().min(8).max(2000)
});

export const annotationModerationSchema = z.object({
  action: z.enum(["withdraw", "restore"]),
  reason: z.string().trim().min(8).max(1000)
});

export const desktopAnnotationHandoffSchema = z.object({
  body: z.string().trim().max(8000).default(""),
  organizationId: z.string().trim().min(1).max(200).optional(),
  shareToPlaza: z.boolean().default(true),
  tags: annotationTagsSchema,
  targets: z.array(annotationTargetSchema).min(1).max(100),
  visibility: annotationVisibilitySchema.default("public")
}).superRefine((value, context) => {
  if (value.shareToPlaza && value.visibility !== "public") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["shareToPlaza"], message: "只有公开批注可以进入广场。" });
  }
  if (value.visibility === "organization" && !value.organizationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organizationId"], message: "组织可见批注必须指定组织。" });
  }
  if (value.visibility !== "organization" && value.organizationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organizationId"], message: "只有组织可见批注可以指定组织。" });
  }
});

export const desktopCommunityAnnotationSchema = z.object({
  annotationId: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  createdAt: z.string().datetime(),
  queueKey: z.string().trim().min(1).max(500),
  status: z.literal("pending_public"),
  targets: z.array(annotationTargetSchema).min(1).max(100),
  updatedAt: z.string().datetime()
}).refine((value) => Date.parse(value.updatedAt) >= Date.parse(value.createdAt), {
  message: "批注更新时间不能早于创建时间。",
  path: ["updatedAt"]
});

export const desktopCommunityAnnotationBatchSchema = z.object({
  annotations: z.array(desktopCommunityAnnotationSchema).min(1).max(100)
});

const desktopPublicationOperationSchema = z.object({
  annotationId: z.string().trim().min(1).max(200),
  queueKey: z.string().trim().min(1).max(500),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime()
});

const desktopPublicationSourcePassageSchema = z.object({
  anchorHash: z.string().trim().min(8).max(500),
  excerpt: z.string().trim().min(1).max(4000),
  page: z.number().int().positive().optional(),
  rects: z.array(rectangleSchema).max(200).default([])
}).strict();

const desktopPublicationUpsertSchema = desktopPublicationOperationSchema.extend({
  body: z.string().trim().min(1).max(8000),
  literatureId: z.string().trim().min(1).max(200),
  operation: z.literal("upsert"),
  sourcePassage: desktopPublicationSourcePassageSchema
}).strict();

const desktopPublicationRetractSchema = desktopPublicationOperationSchema.extend({
  operation: z.literal("retract"),
  remoteAnnotationId: z.string().trim().min(1).max(200)
}).strict();

export const desktopAnnotationPublicationBatchSchema = z.object({
  operations: z.array(z.discriminatedUnion("operation", [
    desktopPublicationUpsertSchema,
    desktopPublicationRetractSchema
  ])).min(1).max(100)
}).strict();
