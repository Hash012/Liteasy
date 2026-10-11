import { useObjectWorkbench } from "../../objects/objectWorkbenchPort";
import { parseLiteasyPath } from "../../resource-filesystem/liteasyPath";
import type { AssistantMessage } from "../../assistant/assistant.types";
import type { Citation } from "../../retrieval/retrieval.types";
import type { Paper } from "../../workspace/workspace.types";
import { collectPaperAnchors, paperAnchorsFromCitations } from "../../paper-anchors/paperAnchorEntity";
import { accessibleEvidenceSources, bindEvidenceSnapshots, evidenceReportFromAnchors } from "../evidenceAdapters";
import { evidenceAnswerRevision, parseEvidenceReport, projectEvidenceReport, type EvidencePassage } from "../evidenceReport";
import { EvidenceLens } from "./EvidenceLens";

export function MessageEvidence({ message, papers, onOpenCitation, onOpenAsset }: {
  message: AssistantMessage; papers: Paper[]; onOpenCitation?: (citation: Citation) => void;
  onOpenAsset?: (path: string) => void | Promise<void>;
}) {
  const workbench = useObjectWorkbench();
  const anchors = collectPaperAnchors(message.paperAnchors ?? [], paperAnchorsFromCitations(message.citations ?? [], papers, message.id));
  const parsed = parseEvidenceReport(message.evidenceReport);
  const report = parsed ?? evidenceReportFromAnchors({ id: message.id, answer: message.content, anchors, audit: message.audit });
  if (message.publicWorkflowAudits?.length) {
    report.verifications = [...report.verifications, ...message.publicWorkflowAudits.map((audit, index) => ({
      id: `${message.id}:workflow:${index}`, checkerKind: "none" as const, origin: "legacy" as const,
      status: "skipped" as const, evaluatedClaimIds: [], reviewedPassageIds: [], runId: report.runId,
      answerRevision: report.answerRevision, checkerIdentity: "流程检查记录（非逐条语义核验）",
      finding: [...(audit.issueLabels ?? []), ...(audit.checks ?? []).map(check => `${check.label}：${check.status === "blocked" ? "需复核" : "流程记录"}${check.summary ? `；${check.summary}` : ""}`)].join("；")
    }))];
  }
  const sourceIds = accessibleEvidenceSources(report, anchors);
  // Opening still resolves through the workbench/asset service and its current permissions.
  for (const source of report.sources) {
    if (source.kind === "object" && source.resourcePath && workbench?.scopeId && source.scopeId === workbench.scopeId) {
      try { parseLiteasyPath(source.resourcePath, workbench.scopeId); sourceIds.add(source.id); } catch { /* Different scope stays inaccessible. */ }
    }
  }
  const currentRevisions = new Map(report.sources.flatMap(source => {
    const paper = papers.find(item => item.id === source.paperId);
    return paper?.contentHash ? [[source.id, paper.contentHash] as const] : [];
  }));
  const projected = projectEvidenceReport(bindEvidenceSnapshots(report, anchors), { answerRevision: evidenceAnswerRevision(message.content),
    accessibleSourceIds: sourceIds, currentRevisions, allowedScopeIds: new Set(workbench?.scopeId ? [workbench.scopeId] : []),
    streaming: !!message.agentActivity && message.agentActivity.status !== "completed" });
  const sourceMap = new Map(projected.sources.map(source => [source.id, source]));
  const resolveAnchor = (passage: EvidencePassage) => anchors.find(anchor => anchor.id === passage.evidenceAnchorId &&
    anchor.snapshot.quote === passage.quote && anchor.source.paperId === sourceMap.get(passage.sourceId)?.paperId && anchor.locator.page === passage.locator.page);
  const canOpen = (passage: EvidencePassage) => {
    if (passage.locatorIntegrity === "stale") return false;
    const source = sourceMap.get(passage.sourceId);
    if (source?.kind === "object" && source.resourcePath) return !!onOpenAsset;
    const anchor = resolveAnchor(passage);
    return !!anchor?.locator.page && !!(workbench?.openPaperAnchor || onOpenCitation);
  };
  if (parsed && !parsed.sources.length && !parsed.claims.length && !parsed.verifications.length && !message.publicWorkflowAudits?.length) return null;
  if (!parsed && !anchors.length && !message.audit && !message.publicWorkflowAudits?.length) return null;
  return <EvidenceLens report={projected} canOpenPassage={canOpen} onOpenPassage={async passage => {
    if (!canOpen(passage)) throw new Error("来源暂不可用。");
    const source = sourceMap.get(passage.sourceId);
    if (source?.kind === "object" && source.resourcePath) { await onOpenAsset?.(source.resourcePath); return; }
    const anchor = resolveAnchor(passage)!;
    if (workbench?.openPaperAnchor) await workbench.openPaperAnchor(anchor);
    else onOpenCitation?.(message.citations?.find(citation => citation.paperId === anchor.source.paperId && citation.page === anchor.locator.page && citation.snippet === anchor.snapshot.quote) ?? { paperAnchor: anchor, paperId: anchor.source.paperId, page: anchor.locator.page!, snippet: anchor.snapshot.quote });
  }} />;
}
