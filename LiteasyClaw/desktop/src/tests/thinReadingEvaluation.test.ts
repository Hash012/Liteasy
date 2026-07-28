import { describe, expect, test } from "vitest";
import {
  evaluateThinReadingGoldCase,
  evaluateThinReadingSuite
} from "../app/features/thin-reading/thinReadingEvaluation";
import { thinReadingGoldFixtures } from "./fixtures/thinReadingGoldFixtures";

describe("thinReadingEvaluation", () => {
  test("passes the curated multi-type reference suite", () => {
    const report = evaluateThinReadingSuite(thinReadingGoldFixtures);

    expect(new Set(thinReadingGoldFixtures.map(({ gold }) => gold.paperType))).toEqual(new Set([
      "dataset",
      "experimental",
      "humanities",
      "survey",
      "systems",
      "theoretical"
    ]));
    expect(new Set(thinReadingGoldFixtures.map(({ gold }) => gold.stage))).toEqual(new Set([
      "branch",
      "root"
    ]));
    expect(report.passed).toBe(true);
    expect(report.failedGoldIds).toEqual([]);
    expect(report.averageScore).toBeGreaterThanOrEqual(0.9);
  });

  test("reports semantic, citation, language, and sentence-boundary regressions together", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const candidate = {
      ...fixture.candidate,
      evidence: {
        ...fixture.candidate.evidence,
        claims: [{
          evidenceIds: ["evidence-unrelated"],
          id: "claim-regressed",
          status: "unsupported" as const,
          text: "A generic introduction without a retained result."
        }],
        paperEvidence: ["evidence-unrelated"],
        paperEvidenceSpans: [],
        summarySentences: [{
          evidenceIds: ["evidence-unrelated"],
          externalKnowledge: [],
          id: "sentence-regressed",
          status: "grounded" as const,
          text: "A generic introduction without a retained result."
        }]
      },
      omittedSections: [],
      paperType: "survey" as const,
      summary: "A generic introduction without a retained result."
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });
    const issueCodes = report.issues.map((issue) => issue.code);

    expect(report.passed).toBe(false);
    expect(issueCodes).toEqual(expect.arrayContaining([
      "citation_precision_below_threshold",
      "language_inconsistent",
      "omitted_section_recall_below_threshold",
      "paper_type_mismatch",
      "sentence_boundary_incomplete",
      "summary_core_recall_below_threshold",
      "unsupported_claim_ratio_above_threshold"
    ]));
  });

  test("does not award citation precision when required gold evidence is not cited", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-systems-acorn"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          claims: [],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: []
        }
      },
      gold: fixture.gold
    });

    expect(report.metrics.citationPrecision.score).toBe(0);
    expect(report.metrics.unsupportedClaimRatio.score).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "citation_precision_below_threshold"
    }));
  });

  test("fails a fluent branch that drops both the selected target and parent continuity", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-maxsim"
    )!;
    const candidate = {
      ...fixture.candidate,
      evidence: {
        ...fixture.candidate.evidence,
        claims: fixture.candidate.evidence.claims?.map((claim) => ({
          ...claim,
          text: "实验部分还包含若干常规结果，值得继续阅读。"
        }))
      },
      summary: "实验部分还包含若干常规结果，值得继续阅读。"
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });

    expect(report.passed).toBe(false);
    expect(report.metrics.branchRelevance.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "branch_relevance_below_threshold"
    }));
  });

  test("requires an explicit external boundary when external sources enter the node", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: { ...fixture.candidate, withinPaperClosure: true },
      gold: fixture.gold
    });

    expect(report.passed).toBe(false);
    expect(report.metrics.closureBoundaryAccuracy.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "closure_boundary_mismatch"
    }));
  });
});
