import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { generatedVisualizationModalities } from "../app/features/visualization/visualizationArtifact.types";
import {
  evaluateGenerationDecisions,
  parseMultimodalDecisionEvaluationDataset,
  type MultimodalDecisionEvaluationRecord
} from "../app/features/visualization/visualizationDecisionEvaluation";
import { getAvailableVisualizationModalities } from "../app/features/visualization/visualizationRendererRegistry";
import {
  multimodalEvaluationFixtures,
  type MultimodalEvaluationFixture
} from "./fixtures/multimodalEvaluationFixtures";

const decisionDataset = parseMultimodalDecisionEvaluationDataset(JSON.parse(readFileSync(resolve(
  process.cwd(),
  "../../../../development/test-data/thin-reading-multimodal/planner-decision-evaluation.v2.json"
), "utf8")));

export type MultimodalEvaluationResult = {
  hardGate: "pass" | "fail";
  modality: string;
  status: "pass" | "omitted";
};

export async function runMultimodalEvaluation(
  fixtures: readonly MultimodalEvaluationFixture[],
  decisionRecords: readonly MultimodalDecisionEvaluationRecord[]
) {
  const available = new Set(getAvailableVisualizationModalities());
  const generatedModalities = new Set<string>(generatedVisualizationModalities);
  const missingModalities = fixtures
    .map((fixture) => fixture.modality)
    .filter((modality) => generatedModalities.has(modality) && !available.has(modality));
  const results: MultimodalEvaluationResult[] = fixtures.map((fixture) => ({
    hardGate: fixture.evidenceClaimIds.length > 0 && fixture.expectedObjectIds.length > 0 && fixture.accessibilitySummary.length > 0 ? "pass" : "fail",
    modality: fixture.modality,
    status: available.has(fixture.modality) ? "pass" : "omitted"
  }));
  return {
    missingModalities,
    ...evaluateGenerationDecisions(decisionRecords),
    results,
  };
}

describe("multimodal evaluation gates", () => {
  test("every requested modality has a passing fixture or explicit fail-closed result", async () => {
    const report = await runMultimodalEvaluation(multimodalEvaluationFixtures, decisionDataset.records);

    expect(report.missingModalities).toEqual([]);
    expect(report.results.every((result) => result.hardGate === "pass" || result.status === "omitted")).toBe(true);
    expect(report.decisionAccuracy).toBe(1);
    expect(report.necessaryGenerationRecall).toBe(1);
    expect(report.unnecessaryGenerationRate).toBe(0);
    expect(report.pendingExpertReviews).toBe(0);
    expect(report.qualityGateEligible).toBe(true);
    expect(report.qualityGatePassed).toBe(true);
  });
});
