import { expect, test, vi } from "vitest";
import {
  createVisualizationRevalidationWorkerClient,
  revalidateVisualizationArtifactInWorker,
  type VisualizationRevalidationWorkerMessage,
  type VisualizationRevalidationWorkerPort
} from "../app/features/visualization/visualizationRevalidationWorker";
import { parseVisualizationArtifactEnvelope } from "../app/features/visualization/visualizationRuntime";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";
import { registerVisualizationValidator } from "../app/features/visualization/visualizationValidatorRegistry";

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

test("reconstructs context and runs current registered hard validators in the worker", async () => {
  const result = await revalidateVisualizationArtifactInWorker({
    artifact: envelope.artifact,
    artifactIndex: envelope.artifactIndex,
    expectedHardValidatorVersions: { "artifact-schema": "1.0.0" },
    requestId: "request-1",
    type: "revalidate"
  });
  expect(result).toEqual({
    outcome: "pass",
    requestId: "request-1",
    type: "result",
    usedHardValidatorVersions: { "artifact-schema": "1.0.0" }
  });
});

const upgradeValidator = {
  gate: "hard" as const,
  id: "test-upgrade-validator",
  validate: () => ({ gate: "hard" as const, outcome: "pass" as const, validatorId: "test-upgrade-validator", validatorVersion: "2" }),
  version: "2"
};
registerVisualizationValidator(upgradeValidator);

test("uses the current validator version rather than the artifact's old version", async () => {
  const result = await revalidateVisualizationArtifactInWorker({
    artifact: envelope.artifact,
    artifactIndex: {
      ...envelope.artifactIndex,
      hardValidatorVersions: { "test-upgrade-validator": "1" }
    },
    expectedHardValidatorVersions: { "test-upgrade-validator": "2" },
    requestId: "request-2",
    type: "revalidate"
  });
  expect(result).toEqual({
    outcome: "pass",
    requestId: "request-2",
    type: "result",
    usedHardValidatorVersions: { "test-upgrade-validator": "2" }
  });
});

test("fails worker revalidation when a current validator version is missing or unexpected", async () => {
  const result = await revalidateVisualizationArtifactInWorker({
    artifact: envelope.artifact,
    artifactIndex: envelope.artifactIndex,
    expectedHardValidatorVersions: { "test-upgrade-validator": "1" },
    requestId: "request-3",
    type: "revalidate"
  });
  expect(result).toMatchObject({ outcome: "fail", requestId: "request-3", type: "result" });
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
  const pending = client.revalidate({ artifact: envelope.artifact, artifactIndex: envelope.artifactIndex, expectedHardValidatorVersions: envelope.artifactIndex.hardValidatorVersions });
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    artifact: envelope.artifact,
    artifactIndex: envelope.artifactIndex,
    expectedHardValidatorVersions: envelope.artifactIndex.hardValidatorVersions,
    type: "revalidate"
  }));
  const request = vi.mocked(worker.postMessage).mock.calls[0][0] as Extract<VisualizationRevalidationWorkerMessage, { type: "revalidate" }>;
  for (const listener of listeners) listener({ data: { outcome: "pass", requestId: request.requestId, type: "result", usedHardValidatorVersions: envelope.artifactIndex.hardValidatorVersions } } as MessageEvent<VisualizationRevalidationWorkerMessage>);
  await expect(pending).resolves.toMatchObject({ outcome: "pass" });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

test("cancels and terminates in-flight worker requests", async () => {
  const workers: VisualizationRevalidationWorkerPort[] = [];
  const client = createVisualizationRevalidationWorkerClient({ workerFactory: () => {
    const worker: VisualizationRevalidationWorkerPort = {
      addEventListener: () => undefined,
      postMessage: vi.fn(),
      removeEventListener: () => undefined,
      terminate: vi.fn()
    };
    workers.push(worker);
    return worker;
  } });
  const controller = new AbortController();
  const pending = client.revalidate({ artifact: envelope.artifact, artifactIndex: envelope.artifactIndex, expectedHardValidatorVersions: envelope.artifactIndex.hardValidatorVersions }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("visualization_revalidation_cancelled");
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  const second = client.revalidate({ artifact: envelope.artifact, artifactIndex: envelope.artifactIndex, expectedHardValidatorVersions: envelope.artifactIndex.hardValidatorVersions });
  expect(workers).toHaveLength(2);
  client.terminate();
  await expect(second).rejects.toThrow("visualization_revalidation_terminated");
  expect(workers[1].terminate).toHaveBeenCalledOnce();
});
