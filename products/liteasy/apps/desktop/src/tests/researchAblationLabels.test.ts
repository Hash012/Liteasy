import { expect, test } from "vitest";
import { researchAblationLabelsSchema, researchAblationQuality, type ResearchAblationLabels } from "./fixtures/researchAblationLabels";

const labels: ResearchAblationLabels = {
  origin: "independent_human", annotator: "reviewer", sourceSha256: "hash", question: "question", keyEvidenceIds: ["p1", "p2"],
  strategies: [{ strategy: "direct_model", answer: "answer", recoveredEvidenceIds: ["p1"], claims: [{ text: "first", support: "supported" }, { text: "second", support: "unsupported" }] }]
};
const input = { sourceSha256: "hash", question: "question", strategy: "direct_model", answer: "answer", evidenceIds: ["p1", "p2"] };

test("ablation quality stays unmeasured without independent human labels", () => {
  expect(researchAblationQuality(input)).toEqual({ keyEvidenceRecall: null, unsupportedClaimRate: null, annotationStatus: "not_measured" });
  expect(researchAblationQuality({ ...input, labels: { ...labels, origin: "model_self_review" as "independent_human" } }).annotationStatus).toBe("not_measured");
});

test("quality uses independently supplied evidence and factual-claim denominators", () => {
  expect(researchAblationQuality({ ...input, labels })).toEqual({ keyEvidenceRecall: 0.5, unsupportedClaimRate: 0.5, annotationStatus: "independent_human_labels" });
});

test("stale, incomplete and unknown human labels cannot produce a measured score", () => {
  expect(researchAblationQuality({ ...input, labels: { ...labels, sourceSha256: "changed" } }).annotationStatus).toBe("not_measured");
  expect(researchAblationQuality({ ...input, answer: "a different run", labels }).annotationStatus).toBe("not_measured");
  expect(researchAblationQuality({ ...input, labels: { ...labels, keyEvidenceIds: ["missing"] } }).annotationStatus).toBe("not_measured");
  expect(researchAblationQuality({ ...input, labels: { ...labels, strategies: [{ ...labels.strategies[0], claims: [{ text: "unknown", support: "uncertain" }] }] } }).annotationStatus).toBe("not_measured");
});

const annotationFile = process.env.LITEASY_RESEARCH_ABLATION_LABELS;
const annotationTest = annotationFile ? test : test.skip;
annotationTest("scores only completed independent annotations bound to their original run", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const annotations = JSON.parse(await readFile(annotationFile!, "utf8"));
  const labels = researchAblationLabelsSchema.parse(annotations);
  const report = JSON.parse(await readFile(process.env.LITEASY_RESEARCH_ABLATION_RESULTS ?? resolve("test-results/research-loop-ablation.json"), "utf8"));
  expect(report.schema).toBe("liteasy.research-ablation/v1");
  expect(labels.strategies.map((row) => row.strategy).sort()).toEqual(report.runs.map((row: { strategy: string }) => row.strategy).sort());
  const evidenceIds = (annotations.sources as Array<{ id: string; page: number; quote: string }>).map((source) => {
    expect(source.id.trim()).not.toBe("");
    expect(source.page).toBeGreaterThan(0);
    expect(source.quote.trim()).not.toBe("");
    return source.id;
  });
  expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
  const scores = report.runs.map((row: { strategy: string; answer: string }) => ({
    strategy: row.strategy,
    ...researchAblationQuality({ sourceSha256: report.sourceSha256, question: report.question, answer: row.answer, strategy: row.strategy, evidenceIds, labels })
  }));
  expect(scores.every((score: { annotationStatus: string }) => score.annotationStatus === "independent_human_labels")).toBe(true);
  await writeFile(resolve("test-results/research-loop-ablation-human-scores.json"), JSON.stringify({ schema: "liteasy.research-ablation-human-scores/v1", sourceSha256: report.sourceSha256, annotator: labels.annotator, question: report.question, scores }, null, 2) + "\n");
  console.log(JSON.stringify(scores));
});
