import { collectPaperAnchors, type PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";
import type { AnswerAuditResult } from "../assistant/answerAuditor";
import { evidenceAnswerRevision, type EvidenceReportV1 } from "./evidenceReport";

/** Host-side projection of retrieved snapshots. No generated text is treated as a verifier receipt. */
export function evidenceReportFromAnchors(input: {
  id: string; runId?: string; answer: string; anchors: readonly PaperAnchorEntity[];
  claims?: readonly { id: string; text: string; evidenceIds: readonly string[] }[];
  audit?: AnswerAuditResult; generatedAt?: string;
}): EvidenceReportV1 {
  const anchors = collectPaperAnchors(input.anchors);
  const sources: EvidenceReportV1["sources"] = [];
  const sourceIds = new Map<string, string>();
  const sourceByAnchor = new Map<PaperAnchorEntity, string>();
  for (const anchor of anchors) {
    const key = JSON.stringify([anchor.source.paperId, anchor.source.documentHash, anchor.source.objectRef?.objectId, anchor.source.objectRef?.revision]);
    let sourceId = sourceIds.get(key);
    if (!sourceId) {
      sourceId = `source:${sources.length + 1}`;
      sourceIds.set(key, sourceId);
      sources.push({ id: sourceId, kind: "paper_pdf", title: anchor.presentation.title,
        paperId: anchor.source.paperId, documentHash: anchor.source.documentHash, objectRef: anchor.source.objectRef,
        revision: anchor.source.objectRef?.revision, coverage: anchor.snapshot.quote.trim() ? "partial_text" : "metadata_only" });
    }
    sourceByAnchor.set(anchor, sourceId);
  }
  const answerRevision = evidenceAnswerRevision(input.answer);
  const runId = input.runId ?? input.id;
  const passages = anchors.map((anchor, index) => ({
    id: `passage:${index + 1}`, sourceId: sourceByAnchor.get(anchor)!, quote: anchor.snapshot.quote,
    evidenceAnchorId: anchor.id,
    sourceRevision: anchor.source.objectRef?.revision ?? anchor.source.documentHash,
    locator: { page: anchor.locator.page, start: anchor.locator.pageTextStart, end: anchor.locator.pageTextEnd, precision: anchor.locator.precision },
    // Offsets are recorded, but no current page text comparison has been performed here.
    locatorIntegrity: anchor.locator.page ? "page_only" as const : "unavailable" as const,
  }));
  const claims = (input.claims ?? []).map(claim => ({ id: claim.id, text: claim.text, kind: "unknown" as const,
    assessment: "unverified" as const,
    edges: passages.filter(passage => {
      const anchor = anchors.find(candidate => candidate.id === passage.evidenceAnchorId)!;
      return claim.evidenceIds.some(id => anchor.evidenceIds.includes(id) || anchor.id === id);
    }).map(passage => ({ passageId: passage.id, relation: "unassessed" as const })) }));
  const audit = input.audit;
  return { schema: "liteasy.evidence-report/v1", id: input.id, runId, answerRevision, sources, passages, claims,
    verifications: audit ? [{ id: `${input.id}:structure`, checkerKind: audit.checkerKind === "structural_rules" ? "structural_rules" : "none",
      origin: "structural_rules", status: audit.remoteAttempt?.status === "timed_out" ? "timed_out" : audit.remoteAttempt?.status === "failed" ? "failed" : "completed",
      checkerIdentity: audit.checkerKind === "structural_rules" ? "本地结构检查" : "远端审计服务返回（执行身份未验证）",
      evaluatedClaimIds: [], reviewedPassageIds: [], answerRevision, runId,
      finding: audit.remoteAttempt?.status === "timed_out" ? "远端审计超时，已回退结构检查；未逐条核验。"
        : audit.remoteAttempt?.status === "failed" ? "远端审计失败，已回退结构检查；未逐条核验。"
        : "只记录来源与检查执行情况，不代表结论受到语义支持。" }] : [],
    generatedAt: input.generatedAt ?? new Date().toISOString() };
}

/** Fail closed when a persisted/generated report tries to introduce sources not in the host snapshot. */
export function accessibleEvidenceSources(report: EvidenceReportV1, anchors: readonly PaperAnchorEntity[]) {
  return new Set(report.sources.filter(source => source.kind === "paper_pdf" && !source.resourcePath && anchors.some(anchor => source.paperId === anchor.source.paperId &&
    source.documentHash === anchor.source.documentHash && JSON.stringify(source.objectRef) === JSON.stringify(anchor.source.objectRef)))
    .map(source => source.id));
}

export function evidenceReportFromAssetReads(input: {
  id: string; answer: string; scopeId: string; reads: readonly import("../resource-filesystem/agentAsset.types").AgentAssetRead[];
}): EvidenceReportV1 {
  const report = evidenceReportFromAnchors({ id: input.id, answer: input.answer, anchors: [] });
  input.reads.forEach((read, index) => {
    const sourceId = `source:${index + 1}`;
    report.sources.push({ id: sourceId, kind: "object", title: read.asset.title, resourcePath: read.asset.path,
      revision: read.asset.revision, scopeId: input.scopeId,
      coverage: read.evidence?.kind === "metadata" ? "metadata_only" : read.text ? "partial_text" : "unknown" });
    report.passages.push({ id: `passage:${index + 1}`, sourceId, quote: read.text.slice(0, 4000),
      sourceRevision: read.asset.revision, locator: { precision: "unavailable" }, locatorIntegrity: "unknown",
      retrievalReason: `实际读取字符 ${read.offset + 1}–${read.offset + Math.min(4000, read.text.length)}；仅展示本轮读取快照。` });
  });
  return report;
}

/** A saved report may organize snapshots, never replace the host's actual retrieved quote or locator. */
export function bindEvidenceSnapshots(report: EvidenceReportV1, anchors: readonly PaperAnchorEntity[]): EvidenceReportV1 {
  const matchesSource = (anchor: PaperAnchorEntity, source: EvidenceReportV1["sources"][number]) =>
    anchor.source.paperId === source.paperId && anchor.source.documentHash === source.documentHash &&
    anchor.source.objectRef?.objectId === source.objectRef?.objectId &&
    anchor.source.objectRef?.revision === source.objectRef?.revision;
  const boundSources = report.sources.map(source => {
    if (source.kind !== "paper_pdf") return source;
    const snapshots = anchors.filter(anchor => matchesSource(anchor, source));
    return { ...source, title: snapshots[0]?.presentation.title ?? "来源不可用",
      coverage: snapshots.some(anchor => anchor.snapshot.quote.trim()) ? "partial_text" as const : "metadata_only" as const };
  });
  const sources = new Map(boundSources.map(source => [source.id, source]));
  const passages = report.passages.filter(passage => {
    const source = sources.get(passage.sourceId);
    if (source?.kind !== "paper_pdf") return true;
    return anchors.some(anchor => anchor.id === passage.evidenceAnchorId && matchesSource(anchor, source) &&
      anchor.snapshot.quote === passage.quote && anchor.locator.page === passage.locator.page &&
      anchor.locator.pageTextStart === passage.locator.start && anchor.locator.pageTextEnd === passage.locator.end);
  });
  // Keep unknown edges for the projector to notice incomplete review coverage and downgrade it.
  return { ...report, sources: boundSources, passages };
}
