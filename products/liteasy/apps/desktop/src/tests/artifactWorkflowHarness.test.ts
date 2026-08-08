import { expect, test, vi } from "vitest";
import { createArtifactWorkflowHarness } from "../app/features/artifact-workflow/artifactWorkflowHarness";

function createClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(`2026-07-26T00:00:0${tick}.000Z`);
  };
}

test("runs artifact workflow steps and returns an internal audit trace", async () => {
  const harness = createArtifactWorkflowHarness({
    artifactId: "artifact-1",
    runId: "run-1",
    tracePrefix: "mindmap-workflow",
    traceVersion: "liteasy.mindmap-workflow-trace/v1",
    now: createClock()
  });

  const first = harness.step({
    details: { selectedPaperIds: ["paper-1"] },
    kind: "scope",
    run: () => "scoped",
    summary: "固定任务范围"
  });
  const second = await harness.step({
    details: { externalReferenceCount: 2 },
    kind: "external_lookup",
    run: async () => `${first}:external`,
    summary: "补充外部知识"
  });

  expect(second).toBe("scoped:external");
  expect(harness.trace()).toEqual({
    artifactId: "artifact-1",
    internalOnly: true,
    runId: "run-1",
    steps: [
      {
        completedAt: "2026-07-26T00:00:02.000Z",
        details: { selectedPaperIds: ["paper-1"] },
        kind: "scope",
        startedAt: "2026-07-26T00:00:01.000Z",
        status: "completed",
        stepId: "1-scope",
        summary: "固定任务范围"
      },
      {
        completedAt: "2026-07-26T00:00:04.000Z",
        details: { externalReferenceCount: 2 },
        kind: "external_lookup",
        startedAt: "2026-07-26T00:00:03.000Z",
        status: "completed",
        stepId: "2-external_lookup",
        summary: "补充外部知识"
      }
    ],
    traceId: "mindmap-workflow:run-1:artifact-1",
    version: "liteasy.mindmap-workflow-trace/v1"
  });
});

test("records a blocked trace step when an artifact workflow step fails", async () => {
  const harness = createArtifactWorkflowHarness({
    artifactId: "artifact-2",
    runId: "run-2",
    tracePrefix: "mindmap-workflow",
    traceVersion: "liteasy.mindmap-workflow-trace/v1",
    now: createClock()
  });

  await expect(
    harness.step({
      kind: "verification",
      run: async () => {
        throw new Error("verification failed");
      },
      summary: "确定性校验"
    })
  ).rejects.toThrow("verification failed");

  expect(harness.trace().steps).toEqual([
    {
      completedAt: "2026-07-26T00:00:02.000Z",
      details: { error: "verification failed" },
      kind: "verification",
      startedAt: "2026-07-26T00:00:01.000Z",
      status: "blocked",
      stepId: "1-verification",
      summary: "确定性校验"
    }
  ]);
});

test("checks cancellation before running and after an async step", async () => {
  const controller = new AbortController();
  const harness = createArtifactWorkflowHarness({
    artifactId: "artifact-cancelled",
    runId: "run-cancelled",
    tracePrefix: "mindmap-workflow",
    traceVersion: "liteasy.mindmap-workflow-trace/v1"
  });
  const run = vi.fn(() => "never");
  controller.abort("disabled");
  expect(() => harness.step({ kind: "scope", run, signal: controller.signal, summary: "scope" })).toThrow("artifact_workflow_cancelled");
  expect(run).not.toHaveBeenCalled();

  const second = new AbortController();
  await expect(harness.step({
    kind: "draft",
    run: async () => {
      second.abort("disabled");
      return "draft";
    },
    signal: second.signal,
    summary: "draft"
  })).rejects.toThrow("artifact_workflow_cancelled");
});
