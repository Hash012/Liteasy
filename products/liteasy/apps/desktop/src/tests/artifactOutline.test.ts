import {
  buildArtifactOutline,
  outlineToMarkdown,
  parseStreamingOutlineMarkdown
} from "../app/features/artifacts/artifactOutline";
import type { CompletedMultiPaperAnalysis } from "../app/features/paper-analysis/analysis.types";

test("exports a parent-linked evidence tree as Markdown unordered-list metadata", () => {
  const analysis = {
    citations: [],
    claims: [],
    evidence: [
      {
        analysisRunId: "analysis-1",
        chunkId: "paper-1:p2:chunk-1",
        id: "evidence-1",
        page: 2,
        paperId: "paper-1",
        paperTitle: "ColBERT",
        quote: "late interaction",
        relevance: 0.9,
        retrievalReason: "query_overlap_within_selected_paper",
        summary: "Late interaction 保留 token 级匹配",
        terms: ["ColBERT", "late interaction", "token matching"]
      }
    ],
    evidencePrompt: "",
    paperClaims: [],
    retrievalConfidence: 0.9,
    run: {
      completedAt: "2026-07-20T00:01:00.000Z",
      coverage: {
        coveredPaperIds: ["paper-1"],
        missingPaperIds: [],
        ratio: 1,
        selectedPaperIds: ["paper-1"]
      },
      createdAt: "2026-07-20T00:00:00.000Z",
      id: "analysis-1",
      plan: {
        dimensions: ["方法"],
        maxEvidencePerPaper: 2,
        maxTotalEvidence: 12,
        paperIds: ["paper-1"],
        query: "分析"
      },
      query: "分析",
      status: "completed"
    }
  } satisfies CompletedMultiPaperAnalysis;

  const nodes = buildArtifactOutline({
    analysis,
    papers: [{ id: "paper-1", title: "ColBERT" }],
    title: "Literature Tree Analysis"
  });

  expect(nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "root", kind: "root" }),
    expect.objectContaining({ id: "paper-paper-1", parentId: "root" }),
    expect.objectContaining({ label: "ColBERT", parentId: "terms-paper-1" }),
    expect.objectContaining({
      evidenceIds: ["evidence-1"],
      parentId: "evidence-section-paper-1"
    })
  ]));
  expect(outlineToMarkdown(nodes)).toBe(
    "- Literature Tree Analysis\n" +
    "  - ColBERT\n" +
    "    - 关键名词与概念\n" +
    "      - ColBERT <!-- evidence:evidence-1 -->\n" +
    "      - late interaction <!-- evidence:evidence-1 -->\n" +
    "      - token matching <!-- evidence:evidence-1 -->\n" +
    "    - 证据摘要\n" +
    "      - Late interaction 保留 token 级匹配 <!-- evidence:evidence-1 -->\n"
  );
});

test("parses complete streamed Markdown list lines into provisional parent links", () => {
  expect(parseStreamingOutlineMarkdown(
    "- ColBERT\n  - 核心方法\n    - late interaction [evidence-2-example]\n    - MaxSim\n"
  )).toEqual([
    expect.objectContaining({ id: "stream-node-0", label: "ColBERT", parentId: undefined }),
    expect.objectContaining({ id: "stream-node-1", label: "核心方法", parentId: "stream-node-0" }),
    expect.objectContaining({
      evidenceIds: ["evidence-2-example"],
      label: "late interaction [evidence-2-example]",
      parentId: "stream-node-1"
    }),
    expect.objectContaining({ label: "MaxSim", parentId: "stream-node-1" })
  ]);
});
