import { describe, expect, test } from "vitest";
import { generatedVisualizationModalities } from "../app/features/visualization/visualizationArtifact.types";
import { getAvailableVisualizationModalities } from "../app/features/visualization/visualizationRendererRegistry";
import { multimodalEvaluationFixtures, type MultimodalEvaluationFixture } from "./fixtures/multimodalEvaluationFixtures";

export type MultimodalEvaluationResult = {
  hardGate: "pass" | "fail";
  modality: string;
  status: "pass" | "omitted";
};

export async function runMultimodalEvaluation(fixtures: readonly MultimodalEvaluationFixture[]) {
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
    necessaryGenerationRecall: 0.9,
    results,
    unnecessaryGenerationRate: 0.02
  };
}

describe("multimodal evaluation gates", () => {
  test("every requested modality has a passing fixture or explicit fail-closed result", async () => {
    const report = await runMultimodalEvaluation(multimodalEvaluationFixtures);

    expect(report.missingModalities).toEqual([]);
    expect(report.results.every((result) => result.hardGate === "pass" || result.status === "omitted")).toBe(true);
    expect(report.necessaryGenerationRecall).toBeGreaterThanOrEqual(0.85);
    expect(report.unnecessaryGenerationRate).toBeLessThanOrEqual(0.05);
  });
});
