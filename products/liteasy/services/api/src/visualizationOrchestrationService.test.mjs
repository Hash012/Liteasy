import assert from "node:assert/strict";
import test from "node:test";
import { VisualizationOrchestrationService } from "./visualizationOrchestrationService.mjs";

const defaultInput = {
  artifactId: "artifact-1",
  nodeId: "node-1",
  requestId: "request-1",
  requestedArtifactCount: 1
};

const source = {
  artifactRevision: 3,
  evidence: [{ id: "evidence-1" }],
  intent: { candidateModalities: ["semantic_graph"], requestedBy: "automatic" },
  intentHash: "a".repeat(64),
  nodeId: "node-1"
};

const allowedCapability = {
  allowed: true,
  availableModalities: ["semantic_graph"],
  enabled: true,
  explicitRequestsAllowed: true,
  quota: { available: true },
  serviceAvailable: true
};

function repositoryHarness() {
  const rows = new Map();
  const calls = [];
  const projection = (row) => ({
    artifacts: undefined,
    reasonCode: row.reasonCode,
    requestId: row.requestId,
    resultArtifactIds: row.resultArtifactIds ?? [],
    retryAfterMs: new Set(["queued", "running", "cancel_requested"]).has(row.status) ? 500 : undefined,
    status: row.status
  });
  return {
    calls,
    rows,
    repository: {
      async create(subjectId, input) {
        calls.push(["create", subjectId, input]);
        const existing = rows.get(`${subjectId}:${input.requestId}`);
        if (existing) {
          if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("visualization_request_id_reused");
          return projection(existing);
        }
        const row = { input, requestId: input.requestId, status: "queued" };
        rows.set(`${subjectId}:${input.requestId}`, row);
        return projection(row);
      },
      async get(subjectId, requestId) {
        calls.push(["get", subjectId, requestId]);
        return projection(rows.get(`${subjectId}:${requestId}`));
      },
      async markTerminal(subjectId, requestId, status, reasonCode) {
        calls.push(["markTerminal", subjectId, requestId, status, reasonCode]);
        Object.assign(rows.get(`${subjectId}:${requestId}`), { reasonCode, status });
        return projection(rows.get(`${subjectId}:${requestId}`));
      },
      async requestCancel(subjectId, requestId, idempotencyKey) {
        calls.push(["requestCancel", subjectId, requestId, idempotencyKey]);
        const row = rows.get(`${subjectId}:${requestId}`);
        row.status = row.status === "queued" ? "cancelled" : "cancel_requested";
        row.reasonCode = row.status === "cancelled" ? "cancelled" : undefined;
        return projection(row);
      }
    }
  };
}

function harness({ capability = allowedCapability, sourceValue = source } = {}) {
  const generation = repositoryHarness();
  const workerCalls = [];
  const worker = {
    abort(subjectId, requestId) { workerCalls.push(["abort", subjectId, requestId]); },
    close() {},
    drainOne() {},
    recover() {},
    schedule() { workerCalls.push(["schedule"]); }
  };
  const visualizationService = {
    async accountCapability() { return capability; },
    async publishedArtifacts(_subjectId, artifactIds) {
      return artifactIds.map((artifactId) => ({ artifactId, artifactVersion: "liteasy.visualization/v1" }));
    }
  };
  return {
    ...generation,
    service: new VisualizationOrchestrationService({
      compilerRegistry: { has: (modality) => modality === "semantic_graph" },
      generationRepository: generation.repository,
      sourceResolver: { async resolve() { return sourceValue; } },
      visualizationService,
      worker
    }),
    workerCalls
  };
}

test("starts and exactly replays a source-bound request while rejecting client authority fields", async () => {
  const instance = harness();
  const first = await instance.service.start("user-1", defaultInput, "trace-1");
  const replay = await instance.service.start("user-1", defaultInput, "trace-1");
  assert.deepEqual(replay, first);
  assert.deepEqual(instance.calls[0][2], {
    ...defaultInput,
    artifactRevision: 3,
    intentHash: "a".repeat(64),
    traceId: "trace-1"
  });
  assert.equal(instance.workerCalls.filter(([name]) => name === "schedule").length, 2);
  await assert.rejects(
    () => instance.service.start("user-1", { ...defaultInput, candidateModalities: ["circuit"] }, "trace-1"),
    /visualization_request_invalid/
  );
  await assert.rejects(
    () => instance.service.start("user-1", { ...defaultInput, nodeId: "node-other" }, "trace-1"),
    /visualization_request_id_reused/
  );
});

test("persists fail-closed omissions without scheduling provider work", async (t) => {
  const cases = [
    ["unauthorized", { ...allowedCapability, allowed: false }, "capability_unauthorized"],
    ["preference off", { ...allowedCapability, enabled: false }, "preference_disabled"],
    ["quota exhausted", { ...allowedCapability, quota: { available: false } }, "quota_exhausted"],
    ["modality unavailable", { ...allowedCapability, availableModalities: [] }, "modality_unavailable"]
  ];
  for (const [name, capability, reasonCode] of cases) {
    await t.test(name, async () => {
      const instance = harness({ capability });
      const result = await instance.service.start("user-1", defaultInput, "trace-1");
      assert.equal(result.status, "omitted");
      assert.equal(result.reasonCode, reasonCode);
      assert.deepEqual(instance.workerCalls, []);
    });
  }
});

test("enforces automatic and explicit artifact limits from the authoritative intent", async () => {
  await assert.rejects(
    () => harness().service.start("user-1", { ...defaultInput, requestedArtifactCount: 2 }, "trace-1"),
    /visualization_requested_count_invalid/
  );
  const explicit = harness({ sourceValue: {
    ...source,
    intent: { ...source.intent, requestedBy: "explicit_user_request" }
  } });
  assert.equal((await explicit.service.start(
    "user-1",
    { ...defaultInput, requestedArtifactCount: 2 },
    "trace-1"
  )).status, "queued");
});

test("reloads succeeded artifacts and updates cancellation before aborting in-memory work", async () => {
  const instance = harness();
  await instance.service.start("user-1", defaultInput, "trace-1");
  Object.assign(instance.rows.get("user-1:request-1"), {
    resultArtifactIds: ["result-1"],
    status: "succeeded"
  });
  const status = await instance.service.status("user-1", "request-1");
  assert.deepEqual(status.artifacts, [{ artifactId: "result-1", artifactVersion: "liteasy.visualization/v1" }]);

  const cancellable = harness();
  await cancellable.service.start("user-1", defaultInput, "trace-1");
  await cancellable.service.cancel("user-1", "request-1", { idempotencyKey: "request-1:cancel" }, "trace-2");
  assert.deepEqual(cancellable.calls.at(-1).slice(0, 2), ["requestCancel", "user-1"]);
  assert.deepEqual(cancellable.workerCalls.at(-1), ["abort", "user-1", "request-1"]);
});
