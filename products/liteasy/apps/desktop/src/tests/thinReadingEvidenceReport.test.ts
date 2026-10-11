import { expect, test } from "vitest";
import { thinReadingEvidenceReport } from "../app/features/thin-reading/thinReadingEvidenceReport";
import { evidenceCounts, parseEvidenceReport } from "../app/features/evidence/evidenceReport";
import { createThinReadingDocument, advanceThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { parseThinReadingDocument } from "../app/features/thin-reading/thinReadingVersioning";
import type { ThinReadingNodeSeed } from "../app/features/thin-reading/thinReading.types";

function seed(): ThinReadingNodeSeed {
  return { summary: "来源声称改善性能。", withinPaperClosure: true, recommendations: [], omittedSections: [], evidence: {
    paperEvidence: ["e-1"], externalKnowledge: [],
    paperEvidenceSpans: [{ id: "e-1", paperId: "paper", page: 2, quote: "Performance improves in one benchmark.", confidence: 0.99 }],
    summarySentences: [{ id: "sentence-1", text: "来源声称改善性能。", evidenceIds: ["e-1"], externalKnowledge: [], status: "grounded" }],
    readingReview: { mode: "rigorous", status: "advisory", note: "生成时自查，仅供参考。" }
  } };
}
function document() {
  return createThinReadingDocument({ artifactId: "reading-report", papers: [{ id: "paper", title: "Performance Paper" }], rootSeed: seed(), targetLanguage: "zh-CN" });
}

test("roots and deep nodes freeze and restore unverified claim reports without promoting generation self-review", () => {
  const root = document();
  const child = advanceThinReadingDocument(root, { parentNodeId: root.activeNodeId, title: "进一步解释", source: { kind: "omitted_section", label: "解释", sectionKey: "explanation" }, seed: seed() });
  for (const node of Object.values(child.nodes)) {
    const report = node.evidence.evidenceReport!;
    expect(parseEvidenceReport(report)).toBeDefined();
    expect(report.claims[0]).toMatchObject({ assessment: "unverified", edges: [{ passageId: "passage:1", relation: "unassessed" }] });
    expect(report.passages[0].locatorIntegrity).toBe("page_only");
    expect(report.verifications).toEqual([]);
    expect(Object.isFrozen(report.claims[0].edges)).toBe(true);
    expect(node.evidence.readingReview?.status).toBe("advisory");
  }
  const restored = parseThinReadingDocument(JSON.parse(JSON.stringify(child)));
  expect(restored.nodes[restored.activeNodeId].evidence.evidenceReport).toEqual(child.nodes[child.activeNodeId].evidence.evidenceReport);
});

test("a corrupt optional report is dropped without losing a readable document", () => {
  const original = document();
  const corrupt = JSON.parse(JSON.stringify(original));
  corrupt.nodes[corrupt.activeNodeId].evidence.evidenceReport = { schema: "wrong", claims: "broken" };
  const restored = parseThinReadingDocument(corrupt);
  expect(restored.nodes[restored.activeNodeId].summary).toBe(seed().summary);
  expect(restored.nodes[restored.activeNodeId].evidence.evidenceReport).toBeUndefined();
  const node = restored.nodes[restored.activeNodeId];
  expect(thinReadingEvidenceReport({ id: "restored", summary: node.summary, evidence: node.evidence }).claims[0].assessment).toBe("unverified");
});

test("legacy nodes without sentence bindings retain references without inventing claim support", () => {
  const input = seed();
  input.evidence.summarySentences = undefined;
  const report = thinReadingEvidenceReport({ id: "legacy", summary: input.summary, evidence: input.evidence });
  expect(report.claims).toEqual([]);
  expect(evidenceCounts(report)).toMatchObject({ sources: 1, passages: 1 });
});

test("abstract snapshots stay explicitly abstract-only and inaccessible extra sources are removed", () => {
  const input = seed();
  input.evidence.externalSources = [{ id: "openalex:W1", title: "External paper", abstract: "Only this abstract was retrieved.", authors: [], provider: "openalex", relation: "topic_search", relevance: 0.9, retrievalQuery: "performance", sourceId: "W1", sourceRecordUrl: "https://openalex.org/W1", url: "https://openalex.org/W1" }];
  const report = thinReadingEvidenceReport({ id: "abstract", summary: input.summary, evidence: input.evidence });
  expect(report.sources[1].coverage).toBe("abstract_only");
  expect(report.passages[1].quote).toBe("Only this abstract was retrieved.");
  input.evidence.evidenceReport = { ...report, sources: [...report.sources, { id: "unknown", kind: "paper_pdf", title: "Other account paper", paperId: "private", coverage: "full_text" }] };
  expect(thinReadingEvidenceReport({ id: "restored", summary: input.summary, evidence: input.evidence }).sources.some((source) => source.id === "unknown")).toBe(false);
});
