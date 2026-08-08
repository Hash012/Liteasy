import type { CompletedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { IntuitionGraphDocument, IntuitionGraphEdge, IntuitionGraphNode } from "./intuitionGraph.types";

function graphId(value: string) { return `graph-${value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+/, "g-")}`.slice(0, 120); }

export function createEvidenceBackedBaseGraph(input: {
  analysis: CompletedMultiPaperAnalysis;
  artifactId: string;
  workId: string;
}): IntuitionGraphDocument {
  const claims = input.analysis.claims.filter((claim) => claim.evidenceIds.length > 0).slice(0, 5);
  const fallbackEvidence = input.analysis.evidence.slice(0, 5);
  const rootEvidenceIds = claims[0]?.evidenceIds ?? fallbackEvidence.map((evidence) => evidence.id);
  const rootLabel = claims[0]?.text ?? input.analysis.run.query;
  const rootNode: IntuitionGraphNode = {
    id: "Thesis", status: "complete", kind: "thesis", baseLevel: 0, label: rootLabel,
    summary: claims[0]?.text ?? "当前检索到的论文证据摘要。", evidenceIds: rootEvidenceIds,
    source: { type: "paper", analysisRunId: input.analysis.run.id }, confidence: claims[0]?.confidence ?? input.analysis.retrievalConfidence,
    expandable: true, tags: ["core-conclusion"]
  };
  const supportingClaims = claims.slice(1).map((claim, index): IntuitionGraphNode => ({
    id: `Claim-${index + 1}`, status: "complete", kind: "concept", baseLevel: 1, label: claim.text,
    summary: claim.text, evidenceIds: claim.evidenceIds, source: { type: "paper", analysisRunId: input.analysis.run.id },
    confidence: claim.confidence, expandable: true, tags: [claim.stance]
  }));
  const evidenceNodes = (supportingClaims.length ? [] : fallbackEvidence).map((evidence, index): IntuitionGraphNode => ({
    id: `Evidence-${index + 1}`, status: "complete", kind: "evidence", baseLevel: 1, label: evidence.summary,
    summary: evidence.quote, evidenceIds: [evidence.id], source: { type: "paper", analysisRunId: input.analysis.run.id },
    confidence: evidence.relevance, expandable: false, tags: evidence.terms.slice(0, 4)
  }));
  const nodes = [rootNode, ...supportingClaims, ...evidenceNodes];
  const edges: IntuitionGraphEdge[] = nodes.slice(1).map((node, index) => ({
    id: `thesis-expands-${index + 1}`, sourceNodeId: "Thesis", targetNodeId: node.id, kind: "expands",
    label: "证据支撑", evidenceIds: node.status === "complete" ? node.evidenceIds : []
  }));
  return {
    version: "liteasy-intuition-graph/v1", id: graphId(input.artifactId), workId: input.workId,
    rootNodeId: "Thesis", revision: 1, nodes, edges,
    provenance: { createdAt: input.analysis.run.completedAt, generatedBy: "rule", analysisRunId: input.analysis.run.id, traceId: input.artifactId }
  };
}
