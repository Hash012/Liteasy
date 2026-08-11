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
  kind: z.enum([
    "doi",
    "arxiv_id",
    "semantic_scholar_id",
    "openalex_id",
    "openreview_id",
    "dblp_key",
    "pmlr_id",
    "title_authors_year_hash"
  ]),
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
    literatureId: z.string().trim().min(1).max(200),
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

export const confirmableLiteratureIdentifierKindSchema = z.enum([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id",
  "openreview_id",
  "dblp_key",
  "pmlr_id"
]);

export const candidateLiteratureAliasKindSchema = z.enum([
  "title_authors_year_hash"
]);

export const literatureIdentifierKindSchema = z.union([
  confirmableLiteratureIdentifierKindSchema,
  candidateLiteratureAliasKindSchema
]);

export const literatureIdentifierRoleSchema = z.enum(["confirmable", "candidate_alias"]);

export const literatureSourceSchema = z.enum(["public_registry", "manual", "inferred", "metadata"]);

function expectedLiteratureIdentifierRole(kind) {
  return kind === "title_authors_year_hash" ? "candidate_alias" : "confirmable";
}

function isNormalizedLiteratureIdentifier(kind, value, concreteArxiv = false) {
  if (kind === "doi") return /^10\.\d{4,9}\/[^\s?#]+$/u.test(value);
  if (kind === "arxiv_id") {
    const pattern = concreteArxiv
      ? /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})v[1-9]\d*$/
      : /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/;
    return pattern.test(value);
  }
  if (kind === "semantic_scholar_id") return /^(?:corpus:[1-9]\d*|[a-f0-9]{40})$/.test(value);
  if (kind === "openalex_id") return /^W\d+$/.test(value);
  if (kind === "openreview_id") return /^[A-Za-z0-9_-]{6,200}$/.test(value);
  if (kind === "dblp_key") {
    return /^(?:conf|journals)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+$/.test(value) && !value.includes("..");
  }
  if (kind === "pmlr_id") {
    return /^v[1-9]\d{0,3}\/[a-z0-9][a-z0-9._-]{0,199}$/.test(value) && !value.includes("..");
  }
  if (kind === "title_authors_year_hash") return /^(?:sha256:[a-f0-9]{64}|[a-f0-9]{8})$/.test(value);
  return false;
}

export const literatureIdentifierSchema = z.object({
  kind: literatureIdentifierKindSchema,
  role: literatureIdentifierRoleSchema.optional(),
  source: literatureSourceSchema,
  value: z.string().trim().min(1).max(1000)
}).superRefine((value, context) => {
  if (value.role && value.role !== expectedLiteratureIdentifierRole(value.kind)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["role"],
      message: "文献标识角色与标识类型不一致。"
    });
  }
});

const confirmedLiteratureIdentifierSchema = literatureIdentifierSchema.superRefine((value, context) => {
  const role = expectedLiteratureIdentifierRole(value.kind);
  if (role === "confirmable" && value.source !== "public_registry") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source"],
      message: "可确认标识必须来自公共注册来源。"
    });
  }
  if (role === "candidate_alias" && value.source !== "metadata" && value.source !== "public_registry") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source"],
      message: "候选别名只能作为元数据兼容信息。"
    });
  }
  if (!isNormalizedLiteratureIdentifier(value.kind, value.value, true)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "正式文献标识必须是规范格式并指向具体版本。"
    });
  }
}).transform((value) => {
  const role = expectedLiteratureIdentifierRole(value.kind);
  return {
    ...value,
    role,
    source: role === "candidate_alias" ? "metadata" : "public_registry"
  };
});

const literatureDisplaySchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(literatureIdentifierSchema).max(20),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
});

const literatureProviderSchema = z.enum([
  "intuecho",
  "openalex",
  "crossref",
  "arxiv",
  "semantic_scholar",
  "openreview",
  "dblp",
  "pmlr"
]);

const literatureEvidenceProviderSchema = z.enum([
  "openalex",
  "crossref",
  "arxiv",
  "semantic_scholar",
  "openreview",
  "dblp",
  "pmlr"
]);

const literatureSourceEvidenceSchema = z.object({
  artifactHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  artifactUrl: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  entryKey: z.string().regex(/^pmlr-v[1-9]\d{0,3}-[a-z0-9][a-z0-9._-]{0,199}$/),
  sourceKind: z.literal("official_volume_bibtex"),
  volume: z.number().int().positive().max(9999)
}).strict();

const literatureCandidateRelationSchema = z.object({
  direction: z.enum(["from_current", "to_current"]),
  evidence: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0),
  relationType: z.enum(["is_preprint_of", "version_of", "translation_of"]),
  targetIdentifier: z.object({
    kind: confirmableLiteratureIdentifierKindSchema,
    value: z.string().trim().min(1).max(1000)
  }).strict()
}).strict().superRefine((value, context) => {
  if (!isNormalizedLiteratureIdentifier(value.targetIdentifier.kind, value.targetIdentifier.value, true)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetIdentifier", "value"],
      message: "版本关系目标必须是规范化的具体文献标识。"
    });
  }
});

export const literatureCandidateSchema = z.object({
  candidateKey: z.string().trim().min(1).max(1000),
  provider: literatureProviderSchema,
  record: literatureDisplaySchema,
  relations: z.array(literatureCandidateRelationSchema).max(20).optional(),
  recordUrl: z.string().url().refine((value) => new URL(value).protocol === "https:").optional(),
  sourceEvidence: literatureSourceEvidenceSchema.optional()
}).superRefine((value, context) => {
  if (value.provider !== "pmlr") return;
  if (!value.sourceEvidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceEvidence"],
      message: "PMLR 候选必须携带官方卷数据审计证据。"
    });
    return;
  }
  const primary = value.record.identifiers[0];
  const match = primary?.kind === "pmlr_id"
    ? /^v([1-9]\d{0,3})\/([a-z0-9][a-z0-9._-]{0,199})$/.exec(primary.value)
    : null;
  const expectedVolume = Number(match?.[1]);
  const expectedEntryKey = match ? `pmlr-v${match[1]}-${match[2]}` : null;
  const expectedRecordUrl = match ? `https://proceedings.mlr.press/${primary.value}.html` : null;
  let artifactUrlMatches = false;
  try {
    const artifactUrl = new URL(value.sourceEvidence.artifactUrl);
    artifactUrlMatches = artifactUrl.protocol === "https:" && artifactUrl.hostname === "proceedings.mlr.press" &&
      !artifactUrl.username && !artifactUrl.password &&
      !artifactUrl.search && !artifactUrl.hash &&
      artifactUrl.pathname.endsWith(`/v${expectedVolume}/assets/bib/bibliography.bib`);
  } catch {
    artifactUrlMatches = false;
  }
  if (!match || value.candidateKey !== `pmlr:pmlr_id:${primary.value}` ||
    value.recordUrl !== expectedRecordUrl || value.sourceEvidence.volume !== expectedVolume ||
    value.sourceEvidence.entryKey !== expectedEntryKey || !artifactUrlMatches) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceEvidence"],
      message: "PMLR 审计证据必须与来源内 ID、正式记录 URL 和卷级 BibTeX 一致。"
    });
  }
});

export const literatureRecordSchema = z.object({
  ...literatureDisplaySchema.shape,
  identifiers: z.array(confirmedLiteratureIdentifierSchema).min(1).max(20),
  literatureId: z.string().trim().min(1).max(200),
  provenance: z.object({
    confirmedAt: z.string().datetime(),
    mode: z.literal("public_registry"),
    provider: literatureProviderSchema.optional()
  }),
  revision: z.number().int().positive(),
  status: z.literal("confirmed")
}).superRefine((value, context) => {
  if (value.identifiers.every((identifier) => identifier.role === "candidate_alias")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identifiers"],
      message: "正式文献必须至少包含一个经过来源确认的稳定标识。"
    });
  }
});

const literatureResolveHintsSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
  identifiers: z.array(z.object({
    kind: literatureIdentifierKindSchema,
    value: z.string().trim().min(1).max(1000)
  }).strict()).max(20).optional(),
  pmlr: z.object({
    source: z.literal("pmlr"),
    volume: z.number().int().positive().max(9999),
    year: z.number().int().min(1000).max(9999)
  }).strict().optional(),
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
    hints?.title || hints?.year || hints?.authors?.length || hints?.identifiers?.length || hints?.pmlr
  );
  if (!value.query && !hasUsableHint) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "文献检索需要查询文本或至少一个书目提示。"
    });
  }
});

export const literatureConfirmInputSchema = z.object({
  candidateKey: z.string().trim().min(1).max(1000),
  mode: z.enum(["candidate", "corroborated"])
}).strict();

export const literatureProjectionVerificationSchema = z.object({
  literatureId: z.string().trim().min(1).max(200),
  revision: z.number().int().positive()
}).strict();

export const literatureRelationTypeSchema = z.enum([
  "is_preprint_of",
  "version_of",
  "translation_of"
]);

export const literatureRelationSchema = z.object({
  createdAt: z.string().datetime(),
  evidence: z.record(z.string(), z.unknown()),
  fromLiteratureId: z.string().trim().min(1).max(200),
  provider: literatureProviderSchema,
  relationType: literatureRelationTypeSchema,
  toLiteratureId: z.string().trim().min(1).max(200),
  verificationStatus: z.literal("confirmed")
}).strict().refine((value) => value.fromLiteratureId !== value.toLiteratureId, {
  message: "文献版本关系不能指向自身。",
  path: ["toLiteratureId"]
});

export const literatureIdentityClaimSchema = z.object({
  evidence: z.record(z.string(), z.unknown()),
  identifier: confirmedLiteratureIdentifierSchema,
  observedAt: z.string().datetime(),
  provider: literatureEvidenceProviderSchema,
  providerRecordId: z.string().trim().min(1).max(1000),
  verificationStatus: z.literal("confirmed")
}).strict();

export const literatureRelationsResultSchema = z.object({
  claims: z.array(literatureIdentityClaimSchema).max(100),
  literatureId: z.string().trim().min(1).max(200),
  versions: z.array(z.object({
    direction: z.enum(["from_current", "to_current"]),
    literature: literatureRecordSchema,
    relation: literatureRelationSchema
  }).strict()).max(100)
}).strict();

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

const confirmedSourceEvidenceSchema = z.object({
  anchorHash: z.string().trim().min(8).max(500),
  excerpt: z.string().trim().min(1).max(4000),
  literature: confirmedLiteratureReferenceSchema,
  page: z.number().int().positive().optional(),
  rects: z.array(rectangleSchema).max(200).default([])
});

export const annotationTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("whole_document"),
    literature: confirmedLiteratureReferenceSchema
  }),
  confirmedSourceEvidenceSchema.extend({ kind: z.literal("source_passage") }),
  z.object({
    derivedContent: z.object({
      artifactId: z.string().trim().min(1).max(200),
      excerpt: z.string().trim().min(1).max(4000),
      nodeId: z.string().trim().min(1).max(200).optional(),
      version: z.string().trim().min(1).max(200)
    }),
    evidence: z.array(confirmedSourceEvidenceSchema).min(1).max(100),
    kind: z.literal("derived_passage"),
    literature: confirmedLiteratureReferenceSchema
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
  publishAsAnnotation: z.boolean().default(false),
  tags: annotationTagsSchema,
  targets: z.array(annotationTargetSchema).max(100).default([])
}).superRefine((value, context) => {
  if (value.publishAsAnnotation && value.targets.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "独立批注必须关联文献。" });
  }
  if (!value.publishAsAnnotation && value.targets.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "普通回复不保存独立批注目标。" });
  }
});

export const updateReplySchema = z.object({
  body: z.string().trim().min(1).max(8000)
});

export const updateReplyPublicationSchema = z.discriminatedUnion("published", [
  z.object({ published: z.literal(false) }),
  z.object({
    published: z.literal(true),
    tags: annotationTagsSchema,
    targets: z.array(annotationTargetSchema).min(1).max(100)
  })
]);

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
