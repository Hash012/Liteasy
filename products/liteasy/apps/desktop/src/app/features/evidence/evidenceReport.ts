import { z } from "zod";
import { objectRefSchema } from "../objects/objectAnchor.types";

const id = z.string().min(1).max(2048);
const text = z.string().max(200000);
export const claimAssessmentSchema = z.enum(["supported", "conditional", "contested", "contradicted", "insufficient", "unverified"]);
export type ClaimAssessment = z.infer<typeof claimAssessmentSchema>;
const sourceSchema = z.strictObject({
  id, kind: z.enum(["paper_pdf", "paper_abstract", "web", "object"]), title: text,
  resourcePath: z.string().max(8192).startsWith("liteasy://").optional(),
  paperId: id.optional(), objectRef: objectRefSchema.optional(),
  url: z.string().url().refine(value => /^https?:\/\//i.test(value)).optional(),
  documentHash: id.optional(), revision: id.optional(), scopeId: id.optional(),
  coverage: z.enum(["full_text", "partial_text", "abstract_only", "metadata_only", "unknown"]),
});
const passageSchema = z.strictObject({
  id, sourceId: id, quote: text,
  locator: z.strictObject({ page: z.number().int().positive().optional(), start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(), precision: z.enum(["text", "page", "unavailable"]) }),
  locatorIntegrity: z.enum(["exact_text", "page_only", "unknown", "unavailable", "stale"]),
  sourceRevision: id.optional(), retrievalReason: text.optional(), evidenceAnchorId: id.optional(),
});
const claimSchema = z.strictObject({
  id, text, kind: z.enum(["fact", "inference", "recommendation", "unknown"]),
  textSpan: z.strictObject({ textRevision: id, start: z.number().int().nonnegative(), end: z.number().int().positive(), exactText: text }).optional(),
  edges: z.array(z.strictObject({ passageId: id, relation: z.enum(["direct_support", "conditional_support", "contradicts", "context", "mentions", "unassessed"]), condition: text.optional(), explanation: text.optional(), evaluatorId: id.optional() })).max(1000),
  caveat: text.optional(), assessment: claimAssessmentSchema, assessmentId: id.optional(),
});
const verificationSchema = z.strictObject({
  id, checkerKind: z.enum(["none", "structural_rules", "model", "human"]), checkerIdentity: id.optional(),
  // Only host adapters create receipts. Model-generated JSON is never parsed as a receipt.
  origin: z.enum(["independent_verifier", "generation", "legacy", "structural_rules"]),
  status: z.enum(["completed", "failed", "skipped", "timed_out"]),
  evaluatedClaimIds: z.array(id).max(1000), reviewedPassageIds: z.array(id).max(1000),
  answerRevision: id, runId: id, checkedAt: z.string().optional(), finding: text.optional(),
});
export const evidenceReportSchema = z.strictObject({
  schema: z.literal("liteasy.evidence-report/v1"), id, runId: id, answerRevision: id,
  sources: z.array(sourceSchema).max(1000), passages: z.array(passageSchema).max(2000),
  claims: z.array(claimSchema).max(1000), verifications: z.array(verificationSchema).max(1000),
  coverage: z.strictObject({ expectedSourceIds: z.array(id).optional(), unreadSourceIds: z.array(id).optional() }).optional(),
  generatedAt: z.string(),
}).superRefine((report, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const records of [report.sources, report.passages, report.claims, report.verifications]) {
    if (new Set(records.map(record => record.id)).size !== records.length) bad("Duplicate evidence identity");
  }
  const sourceIds = new Set(report.sources.map(source => source.id));
  const passageIds = new Set(report.passages.map(passage => passage.id));
  const claimIds = new Set(report.claims.map(claim => claim.id));
  const verifierIds = new Set(report.verifications.map(record => record.id));
  for (const passage of report.passages) {
    if (!sourceIds.has(passage.sourceId)) bad("Unknown evidence source");
    const { start, end, page, precision } = passage.locator;
    if ((start !== undefined || end !== undefined) && !(start !== undefined && end !== undefined && end > start)) bad("Invalid text range");
    if (precision !== "unavailable" && !page || precision === "text" && start === undefined) bad("Missing source location");
  }
  for (const claim of report.claims) {
    if (claim.edges.some(edge => !passageIds.has(edge.passageId) || edge.evaluatorId && !verifierIds.has(edge.evaluatorId))) bad("Unknown evidence relationship");
    if (claim.assessmentId && !verifierIds.has(claim.assessmentId)) bad("Unknown assessment");
    if (claim.textSpan && claim.textSpan.end <= claim.textSpan.start) bad("Invalid answer span");
  }
  for (const record of report.verifications) {
    if (record.evaluatedClaimIds.some(value => !claimIds.has(value)) || record.reviewedPassageIds.some(value => !passageIds.has(value))) bad("Unknown reviewed record");
  }
});
export type EvidenceReportV1 = z.infer<typeof evidenceReportSchema>;
export type EvidencePassage = EvidenceReportV1["passages"][number];
export type EvidenceClaim = EvidenceReportV1["claims"][number];
export type EvidenceSource = EvidenceReportV1["sources"][number];

/** A corrupt optional report must not invalidate its owning message. */
export function parseEvidenceReport(value: unknown): EvidenceReportV1 | undefined {
  const result = evidenceReportSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Revision of the exact answer, independent of mutable UI formatting. Not a document identity/hash. */
export function evidenceAnswerRevision(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `answer:${value.length}:${(hash >>> 0).toString(16)}`;
}

export type EvidenceProjectionContext = {
  trustedVerificationIds?: ReadonlySet<string>;
  verifiedPassageIds?: ReadonlySet<string>;
  answerText?: string;
  answerRevision?: string;
  streaming?: boolean;
  /** Supplied by an authorized source resolver, never by a generated report. */
  accessibleSourceIds?: ReadonlySet<string>;
  currentRevisions?: ReadonlyMap<string, string>;
  allowedScopeIds?: ReadonlySet<string>;
};
export function projectEvidenceReport(report: EvidenceReportV1, context: EvidenceProjectionContext = {}): EvidenceReportV1 {
  const sources = report.sources.filter(source =>
    (!context.accessibleSourceIds || context.accessibleSourceIds.has(source.id)) &&
    (!source.scopeId || context.allowedScopeIds?.has(source.scopeId)));
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const passages = report.passages.filter(passage => sourceMap.has(passage.sourceId)).map(passage => {
    const source = sourceMap.get(passage.sourceId)!;
    const revision = source.revision ?? source.documentHash ?? source.objectRef?.revision;
    const current = context.currentRevisions?.get(source.id);
    const stale = current && revision !== current || passage.sourceRevision && passage.sourceRevision !== revision;
    const integrity = stale ? "stale" : passage.locatorIntegrity === "exact_text" && (!revision || !current || !context.verifiedPassageIds?.has(passage.id) || passage.locator.precision !== "text")
      ? passage.locator.page ? "page_only" : "unknown" : passage.locatorIntegrity;
    return { ...passage, locatorIntegrity: integrity } as EvidencePassage;
  });
  const passageMap = new Map(passages.map(passage => [passage.id, passage]));
  const records = new Map(report.verifications.map(record => [record.id, record]));
  const answerMatches = !context.streaming && (!context.answerRevision || context.answerRevision === report.answerRevision);
  const claims = report.claims.map(claim => {
    const edges = claim.edges.filter(edge => passageMap.has(edge.passageId));
    const record = claim.assessmentId && records.get(claim.assessmentId);
    const reviewed = answerMatches && record && context.trustedVerificationIds?.has(record.id) && record.status === "completed" && record.origin === "independent_verifier" &&
      ["model", "human"].includes(record.checkerKind) && record.runId === report.runId && record.answerRevision === report.answerRevision &&
      record.evaluatedClaimIds.includes(claim.id) && edges.length === claim.edges.length &&
      edges.every(edge => record.reviewedPassageIds.includes(edge.passageId) && edge.evaluatorId === record.id);
    const located = edges.every(edge => {
      const passage = passageMap.get(edge.passageId)!;
      const source = sourceMap.get(passage.sourceId)!;
      const revision = source.revision ?? source.documentHash ?? source.objectRef?.revision;
      return passage.quote.trim() && !["stale", "unavailable", "unknown"].includes(passage.locatorIntegrity) &&
        revision && context.currentRevisions?.get(source.id) === revision;
    });
    let assessment: ClaimAssessment = "unverified";
    if (reviewed && located) {
      const supports = edges.some(edge => ["direct_support", "conditional_support"].includes(edge.relation));
      const opposes = edges.some(edge => edge.relation === "contradicts");
      if (supports && opposes) assessment = "contested";
      else if (opposes) assessment = "contradicted";
      else if (supports) assessment = edges.some(edge => edge.relation === "conditional_support" || edge.condition) || claim.caveat ? "conditional" : "supported";
      else if (claim.assessment === "insufficient") assessment = "insufficient";
    }
    return { ...claim, edges, assessment,
      textSpan: answerMatches && claim.textSpan?.textRevision === report.answerRevision && context.answerText?.slice(claim.textSpan.start, claim.textSpan.end) === claim.textSpan.exactText ? claim.textSpan : undefined };
  });
  return { ...report, sources, passages, claims };
}

export function evidenceCounts(report: EvidenceReportV1) {
  const passages = new Set(report.passages.map(passage => JSON.stringify([passage.sourceId, passage.locator, passage.quote])));
  const counts: Record<ClaimAssessment, number> = { supported: 0, conditional: 0, contested: 0, contradicted: 0, insufficient: 0, unverified: 0 };
  report.claims.forEach(claim => { counts[claim.assessment]++; });
  return { sources: report.sources.length, passages: passages.size, claims: counts };
}
