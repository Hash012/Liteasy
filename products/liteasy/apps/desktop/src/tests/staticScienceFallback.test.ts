import { expect, test, vi } from "vitest";
import { loadBuiltinSkill } from "../app/features/skills/builtinSkillRegistry";
import { runVisualizationWorkflow } from "../app/features/visualization/visualizationWorkflowHarness";
import { invalidDraft, makeVisualizationWorkflowFixture, stillInvalidDraft, validSourceFigure } from "./fixtures/visualizationWorkflowFixtures";

test("falls back to source figure instead of publishing an invalid static proposal", async () => {
  const result = await runVisualizationWorkflow(makeVisualizationWorkflowFixture({
    fallback: vi.fn().mockResolvedValue(validSourceFigure),
    generate: vi.fn().mockResolvedValue(invalidDraft),
    repair: vi.fn().mockResolvedValue(stillInvalidDraft),
    skill: await loadBuiltinSkill("semantic-graph")
  }));

  expect(result.status).toBe("degraded");
  if (result.status !== "degraded") return;
  expect(result.artifact.modality).toBe("source_figure");
  expect(result.artifact.fallbackHistory).toEqual([
    { from: "semantic_graph", reasonCode: "validation_failed_after_repair", to: "source_figure" }
  ]);
  expect(result.trace.steps.filter((step) => step.kind === "publish")).toHaveLength(1);
});

test("omits when source figure fallback is invalid", async () => {
  const result = await runVisualizationWorkflow(makeVisualizationWorkflowFixture({
    fallback: vi.fn().mockResolvedValue(invalidDraft),
    generate: vi.fn().mockResolvedValue(invalidDraft),
    repair: vi.fn().mockResolvedValue(stillInvalidDraft),
    skill: await loadBuiltinSkill("semantic-graph")
  }));

  expect(result.status).toBe("omitted");
  expect(result.trace.steps.filter((step) => step.kind === "publish")).toHaveLength(0);
});
