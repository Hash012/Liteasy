import { expect, test, vi } from "vitest";
import { runVisualizationWorkflow } from "../app/features/visualization/visualizationWorkflowHarness";
import { invalidDraft, makeVisualizationWorkflowFixture, stillInvalidDraft, validSourceFigure } from "./fixtures/visualizationWorkflowFixtures";

test("repairs once, then falls back and publishes only the verified result", async () => {
  const result = await runVisualizationWorkflow(makeVisualizationWorkflowFixture({
    generate: vi.fn().mockResolvedValue(invalidDraft),
    repair: vi.fn().mockResolvedValue(stillInvalidDraft),
    fallback: vi.fn().mockResolvedValue(validSourceFigure)
  }));
  expect(result.status).toBe("degraded");
  if (result.status !== "degraded") return;
  expect(result.artifact.spec.modality).toBe("source_figure");
  expect(result.trace.steps.filter((step) => step.kind === "repair")).toHaveLength(1);
  expect(result.trace.steps.filter((step) => step.kind === "publish")).toHaveLength(1);
});

test("aborts before publish when the signal changes", async () => {
  const controller = new AbortController();
  controller.abort("preference_disabled");
  await expect(runVisualizationWorkflow(makeVisualizationWorkflowFixture({ signal: controller.signal })))
    .rejects.toThrow("visualization_cancelled");
});

test("propagates the signal through provider and fallback callbacks", async () => {
  const controller = new AbortController();
  const generate = vi.fn().mockResolvedValue(invalidDraft);
  const repair = vi.fn().mockResolvedValue(stillInvalidDraft);
  const fallback = vi.fn().mockResolvedValue(validSourceFigure);
  await runVisualizationWorkflow(makeVisualizationWorkflowFixture({ generate, repair, fallback, signal: controller.signal }));
  expect(generate).toHaveBeenCalledWith(controller.signal);
  expect(repair).toHaveBeenCalledWith(invalidDraft, expect.anything(), controller.signal);
  expect(fallback).toHaveBeenCalledWith("source_figure", stillInvalidDraft, controller.signal);
});
