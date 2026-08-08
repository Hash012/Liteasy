import { describe, expect, test } from "vitest";
import { executeThinReadingEvidenceToolPlan } from "../app/features/thin-reading/thinReadingEvidenceTools";
import type { PreparedMultiPaperAnalysis } from "../app/features/paper-analysis/analysis.types";

function evidence(id: string, page: number, summary: string) {
  return {
    analysisRunId: "analysis-1",
    chunkId: `paper-1:p${page}:chunk-1`,
    id,
    page,
    paperId: "paper-1",
    paperTitle: "Evidence Tools Paper",
    quote: `${summary} Full quote.`,
    relevance: 0.8,
    retrievalReason: "query_overlap",
    summary,
    terms: ["method"]
  };
}

function prepared(): PreparedMultiPaperAnalysis {
  const evidenceItems = [
    evidence("evidence-1", 1, "Introduction and setup."),
    evidence("evidence-2", 4, "MaxSim late interaction improves retrieval precision."),
    evidence("evidence-3", 7, "Ablation identifies a sparse-data limitation.")
  ];
  return {
    citations: [], evidence: evidenceItems, evidencePrompt: "", paperClaims: [], retrievalConfidence: 0.8,
    run: {
      coverage: { coveredPaperIds: ["paper-1"], missingPaperIds: [], ratio: 1, selectedPaperIds: ["paper-1"] },
      createdAt: "2026-07-29T00:00:00.000Z", id: "analysis-1",
      plan: { dimensions: [], maxEvidencePerPaper: 3, maxTotalEvidence: 3, paperIds: ["paper-1"], query: "MaxSim" },
      query: "MaxSim", status: "running"
    }
  };
}

describe("thinReadingEvidenceTools", () => {
  test("executes bounded read/search/view calls against the prepared evidence allowlist", () => {
    const result = executeThinReadingEvidenceToolPlan({
      plan: { pageRequests: [7], searchQueries: ["late interaction"], selectedEvidenceIds: ["evidence-1"] },
      prepared: prepared()
    });

    expect(result.toolCalls).toEqual([
      { evidenceIds: ["evidence-1"], kind: "read" },
      { evidenceIds: ["evidence-2"], kind: "search", query: "late interaction" },
      { evidenceIds: ["evidence-3"], kind: "view", pages: [7] }
    ]);
    expect(result.evidence.map((item) => item.id)).toEqual(["evidence-1", "evidence-2", "evidence-3"]);
  });

  test("does not expose forged IDs, invalid pages, or unmatched search text", () => {
    const result = executeThinReadingEvidenceToolPlan({
      plan: { pageRequests: [-1, 0], searchQueries: ["not present"], selectedEvidenceIds: ["forged", "evidence-2"] },
      prepared: prepared()
    });

    expect(result.toolCalls).toEqual([
      { evidenceIds: ["evidence-2"], kind: "read" },
      { evidenceIds: [], kind: "search", query: "not present" }
    ]);
    expect(result.evidence.map((item) => item.id)).toEqual(["evidence-2"]);
  });
});
