import { describe, expect, it } from "vitest";
import { evidenceCounts, parseEvidenceReport, projectEvidenceReport, type EvidenceReportV1 } from "../app/features/evidence/evidenceReport";
import { evidenceReportFromAnchors } from "../app/features/evidence/evidenceAdapters";
import { paperAnchorFromEvidence } from "../app/features/paper-anchors/paperAnchorEntity";

function report(): EvidenceReportV1 {
  const anchor = paperAnchorFromEvidence({ id: "e1", paperId: "p1", page: 2, quote: "actual quote" });
  anchor.source.documentHash = "v1";
  return evidenceReportFromAnchors({ id: "r1", answer: "claim", anchors: [anchor], claims: [{ id: "c1", text: "claim", evidenceIds: ["e1"] }] });
}
function reviewed(): EvidenceReportV1 {
  const value = report();
  value.verifications = [{ id: "check", origin: "independent_verifier", checkerKind: "model", status: "completed", runId: value.runId, answerRevision: value.answerRevision,
    evaluatedClaimIds: ["c1"], reviewedPassageIds: ["passage:1"] }];
  value.claims[0].assessmentId = "check";
  value.claims[0].edges = [{ passageId: "passage:1", relation: "direct_support", evaluatorId: "check" }];
  return value;
}
const context = { trustedVerificationIds: new Set(["check"]), currentRevisions: new Map([["source:1", "v1"]]) };
describe("EvidenceReport authority and projection", () => {
  it("validates host snapshots and rejects duplicate/dangling identities without throwing", () => {
    expect(parseEvidenceReport(report())).toBeDefined();
    for (const mutate of [
      (r: EvidenceReportV1) => r.sources.push(r.sources[0]),
      (r: EvidenceReportV1) => { r.passages[0].sourceId = "fake"; },
      (r: EvidenceReportV1) => { r.claims[0].edges[0].passageId = "fake"; },
      (r: EvidenceReportV1) => { r.claims[0].assessmentId = "fake"; },
      (r: EvidenceReportV1) => { r.passages[0].locator = { precision: "text", page: 2, start: 5, end: 2 }; },
    ]) { const value = report(); mutate(value); expect(parseEvidenceReport(value)).toBeUndefined(); }
    expect(parseEvidenceReport({ schema: "future" })).toBeUndefined();
  });
  it("does not manufacture legacy claims or semantic support from citations", () => {
    const value = report(); value.claims[0].assessment = "supported";
    expect(projectEvidenceReport(value, context).claims[0].assessment).toBe("unverified");
    expect(evidenceReportFromAnchors({ id: "old", answer: "text", anchors: [] }).claims).toEqual([]);
  });
  it.each(["structural_rules", "none"] as const)("never treats %s as semantic review", kind => {
    const value = reviewed(); value.verifications[0].checkerKind = kind;
    expect(projectEvidenceReport(value, context).claims[0].assessment).toBe("unverified");
  });
  it.each(["failed", "skipped", "timed_out"] as const)("leaves %s unverified", status => {
    const value = reviewed(); value.verifications[0].status = status;
    expect(projectEvidenceReport(value, context).claims[0].assessment).toBe("unverified");
  });
  it("requires independent review, correct run, every edge, and current versions", () => {
    expect(projectEvidenceReport(reviewed(), context).claims[0].assessment).toBe("supported");
    for (const mutate of [
      (r: EvidenceReportV1) => { r.verifications[0].origin = "generation"; },
      (r: EvidenceReportV1) => { r.verifications[0].runId = "other"; },
      (r: EvidenceReportV1) => { r.verifications[0].reviewedPassageIds = []; },
      (r: EvidenceReportV1) => { r.claims[0].edges[0].evaluatorId = undefined; },
    ]) { const value = reviewed(); mutate(value); expect(projectEvidenceReport(value, context).claims[0].assessment).toBe("unverified"); }
    expect(projectEvidenceReport(reviewed()).claims[0].assessment).toBe("unverified");
    expect(projectEvidenceReport(reviewed(), { currentRevisions: new Map([["source:1", "v2"]]) }).passages[0].locatorIntegrity).toBe("stale");
  });
  it("invalidates edited answers and streaming; filters unauthorized sources", () => {
    expect(projectEvidenceReport(reviewed(), { ...context, answerRevision: "edited" }).claims[0].assessment).toBe("unverified");
    expect(projectEvidenceReport(reviewed(), { ...context, streaming: true }).claims[0].assessment).toBe("unverified");
    const value = reviewed(); value.sources[0].scopeId = "organization:other";
    expect(projectEvidenceReport(value, context).sources).toEqual([]);
    expect(projectEvidenceReport(reviewed(), { accessibleSourceIds: new Set() }).passages).toEqual([]);
  });
  it("retains conditions/counterevidence rather than majority voting", () => {
    const value = reviewed(); value.claims[0].edges.push({ passageId: "passage:1", relation: "contradicts", evaluatorId: "check" });
    expect(projectEvidenceReport(value, context).claims[0].assessment).toBe("contested");
    value.claims[0].edges.pop(); value.claims[0].edges[0].condition = "same workload";
    expect(projectEvidenceReport(value, context).claims[0].assessment).toBe("conditional");
  });
  it("counts unique locations across repeated claims and keeps same-title revisions separate", () => {
    const value = report(); value.claims.push({ ...value.claims[0], id: "c2" });
    expect(evidenceCounts(value)).toMatchObject({ sources: 1, passages: 1 });
    const anchor = paperAnchorFromEvidence({ id: "e2", paperId: "p1", page: 2, quote: "quote" });
    const other = { ...anchor, id: "e3", source: { ...anchor.source, documentHash: "different" } };
    expect(evidenceReportFromAnchors({ id: "r", answer: "x", anchors: [anchor, other] }).sources).toHaveLength(2);
  });
});

it("does not trust self-asserted verifier receipts or exact-text claims from persisted JSON", () => {
  const value = reviewed();
  value.passages[0].locatorIntegrity = "exact_text";
  value.passages[0].locator = { page: 2, start: 0, end: 12, precision: "text" };
  const projected = projectEvidenceReport(value, { currentRevisions: context.currentRevisions });
  expect(projected.claims[0].assessment).toBe("unverified");
  expect(projected.passages[0].locatorIntegrity).toBe("page_only");
});

it("requires exact answer-span text and never rewrites unrelated Markdown", () => {
  const value = report();
  value.claims[0].textSpan = { textRevision: value.answerRevision, start: 0, end: 5, exactText: "claim" };
  expect(projectEvidenceReport(value, { answerText: "claim" }).claims[0].textSpan).toBeDefined();
  expect(projectEvidenceReport(value, { answerText: "other" }).claims[0].textSpan).toBeUndefined();
});

it("rejects altered saved quote snapshots and source paths disguised as a paper", async () => {
  const { bindEvidenceSnapshots, accessibleEvidenceSources } = await import("../app/features/evidence/evidenceAdapters");
  const anchor = paperAnchorFromEvidence({ id: "e1", paperId: "p1", page: 2, quote: "actual quote" });
  anchor.source.documentHash = "v1";
  const altered = report(); altered.passages[0].quote = "not present in the paper";
  expect(bindEvidenceSnapshots(altered, [anchor]).passages).toEqual([]);
  const disguised = report(); disguised.sources[0].resourcePath = "liteasy://objects/other?scope=organization%3Aprivate";
  expect(accessibleEvidenceSources(disguised, [anchor]).size).toBe(0);
});
