import { EvidenceLens } from "../evidence/components/EvidenceLens";
import { evidenceAnswerRevision, type EvidenceReportV1 } from "../evidence/evidenceReport";
import type { QuickAskContextSnapshot } from "./pdfQuickAsk";
export function quickAskEvidence(context: QuickAskContextSnapshot, answer: string): EvidenceReportV1 {
  const id = context.snapshotId;
  return {
    schema: "liteasy.evidence-report/v1", id, runId: id, answerRevision: evidenceAnswerRevision(answer),
    sources: [{ id: context.source.paperId, kind: "paper_pdf", title: "速问所用文献", paperId: context.source.paperId,
      revision: context.source.documentRevision, scopeId: context.source.scopeId, coverage: "partial_text" }],
    passages: context.delivered.map((part, index) => ({ id: `${id}:${index}`, sourceId: context.source.paperId, quote: part.text,
      locator: { ...(part.spans[0]?.page ? { page: part.spans[0].page } : {}), precision: part.spans[0]?.page ? "page" : "unavailable" },
      locatorIntegrity: part.spans[0]?.page ? "page_only" : "unknown", sourceRevision: context.source.documentRevision,
      retrievalReason: `实际投递：${part.roles.join(" / ")}` })),
    claims: [], verifications: [], readLedger: context.ledger, generatedAt: context.ledger.deliveries[0]?.at ?? new Date(0).toISOString()
  };
}
export function QuickAskProvenance({ context, answer }: { context?: QuickAskContextSnapshot; answer: string }) {
  if (!context) return <small>历史记录未保存引言与模型投递账本；来源覆盖未知，未经独立语义核验。</small>;
  return <EvidenceLens report={quickAskEvidence(context, answer)} />;
}
