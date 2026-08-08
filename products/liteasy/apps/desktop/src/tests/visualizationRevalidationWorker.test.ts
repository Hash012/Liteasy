import { expect, test, vi } from "vitest";
import {
  createVisualizationRevalidationWorkerClient,
  revalidateVisualizationArtifactInWorker,
  type VisualizationRevalidationWorkerMessage,
  type VisualizationRevalidationWorkerPort
} from "../app/features/visualization/visualizationRevalidationWorker";
import { parseVisualizationArtifactEnvelope } from "../app/features/visualization/visualizationRuntime";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";

const envelope = parseVisualizationArtifactEnvelope({
  artifact: makeVisualizationArtifactFixture(),
  artifactIndex: {
    evidenceHash: "evidence-1",
    hardValidatorVersions: { "artifact-schema": "1.0.0" },
    rendererVersion: "1.0.0",
    skillVersion: "1.0.0",
    specHash: "spec-1"
  },
  status: "ready"
});

test("reconstructs context and runs registered hard validators in the worker", async () => {
  const result = await revalidateVisualizationArtifactInWorker({
    artifact: envelope.artifact,
    artifactIndex: envelope.artifactIndex,
    requestId: "request-1",
    type: "revalidate"
  });
  expect(result).toEqual({ outcome: "pass", requestId: "request-1", type: "result" });
});

test("fails worker revalidation when an indexed validator version no longer matches", async () => {
  const result = await revalidateVisualizationArtifactInWorker({
    artifact: envelope.artifact,
    artifactIndex: {
      ...envelope.artifactIndex,
      hardValidatorVersions: { "artifact-schema": "2.0.0" }
    },
    requestId: "request-2",
    type: "revalidate"
  });
  expect(result).toEqual({ outcome: "fail", requestId: "request-2", type: "result" });
});

test("dispatches only typed artifact data to the worker and resolves its result", async () => {
  const listeners = new Set<(event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void>();
  const worker: VisualizationRevalidationWorkerPort = {
    addEventListener: (_type, listener) => listeners.add(listener),
    postMessage: vi.fn(),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    terminate: vi.fn()
  };
  const client = createVisualizationRevalidationWorkerClient({ workerFactory: () => worker });
  const pending = client.revalidate({ artifact: envelope.artifact, artifactIndex: envelope.artifactIndex });
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    artifact: envelope.artifact,
    artifactIndex: envelope.artifactIndex,
    type: "revalidate"
  }));
  const request = vi.mocked(worker.postMessage).mock.calls[0][0] as Extract<VisualizationRevalidationWorkerMessage, { type: "revalidate" }>;
  for (const listener of listeners) listener({ data: { outcome: "pass", requestId: request.requestId, type: "result" } } as MessageEvent<VisualizationRevalidationWorkerMessage>);
  await expect(pending).resolves.toBe("pass");
  client.terminate();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

test("cancels and terminates in-flight worker requests", async () => {
  const worker: VisualizationRevalidationWorkerPort = {
    addEventListener: () => undefined,
    postMessage: vi.fn(),
    removeEventListener: () => undefined,
    terminate: vi.fn()
  };
  const client = createVisualizationRevalidationWorkerClient({ workerFactory: () => worker });
  const controller = new AbortController();
  const pending = client.revalidate({ artifact: envelope.artifact, artifactIndex: envelope.artifactIndex }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("visualization_revalidation_cancelled");
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "cancel" }));
  client.terminate();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
