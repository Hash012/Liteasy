import assert from "node:assert/strict";
import test from "node:test";
import { VisualizationOrchestrationWorker } from "./visualizationOrchestrationWorker.mjs";

function coded(code) {
  return Object.assign(new Error(code), { code });
}

function source(overrides = {}) {
  return {
    artifactRevision: 2,
    documents: [{ documentId: "document-1", isPrimary: true, sourceIdentityHash: "c".repeat(64) }],
    evidence: [{ id: "evidence-1", quote: "Bounded evidence." }],
    intent: { candidateModalities: ["semantic_graph"], requestedBy: "explicit_user_request" },
    intentHash: "a".repeat(64),
    locale: "zh-CN",
    nodeId: "node-1",
    ...overrides
  };
}

function repository(requestedArtifactCount = 1) {
  const row = {
    artifactId: "artifact-source-1",
    artifactRevision: 2,
    attempts: 0,
    intentHash: "a".repeat(64),
    nodeId: "node-1",
    requestId: "request-1",
    requestedArtifactCount,
    state: "queued",
    subjectId: "user-1",
    traceId: "trace-1"
  };
  const calls = [];
  return {
    calls,
    row,
    value: {
      async claimNext() {
        calls.push(["claimNext"]);
        if (row.state !== "queued") return null;
        row.state = "running";
        row.attempts += 1;
        return { ...row };
      },
      async get() {
        return {
          reasonCode: row.reasonCode,
          requestId: row.requestId,
          resultArtifactIds: row.resultArtifactIds ?? [],
          status: row.state
        };
      },
      async markSucceeded(_subjectId, _requestId, artifactIds, reasonCode) {
        calls.push(["markSucceeded", artifactIds, reasonCode]);
        if (new Set(["cancel_requested", "cancelled"]).has(row.state)) throw coded("visualization_request_cancelled");
        row.state = "succeeded";
        row.resultArtifactIds = artifactIds;
        row.reasonCode = reasonCode;
        return this.get();
      },
      async markTerminal(_subjectId, _requestId, state, reasonCode) {
        calls.push(["markTerminal", state, reasonCode]);
        row.state = state;
        row.reasonCode = reasonCode;
        row.resultArtifactIds = [];
        return this.get();
      },
      async requeueExpired() {
        calls.push(["requeueExpired"]);
        if (row.state === "expired") row.state = "queued";
        return { cancelledRequestIds: [], failedRequestIds: [], requeuedRequestIds: [row.requestId] };
      }
    }
  };
}

function artifact(reservation) {
  return {
    accessibility: { objectReadingOrder: [], summary: "Summary" },
    artifactId: reservation.artifactId,
    artifactVersion: "liteasy.visualization/v1",
    evidenceBindings: [],
    implementation: {},
    interaction: {},
    locale: "zh-CN",
    modality: "semantic_graph",
    nodeId: "node-1",
    semanticObjects: [],
    spec: { modality: "semantic_graph", payload: {} },
    usage: {},
    validation: {}
  };
}

function harness({
  compile,
  generate,
  requestedArtifactCount = 1,
  resolve,
  submit
} = {}) {
  const generation = repository(requestedArtifactCount);
  const calls = [];
  let reservationSequence = 0;
  const sourceResolver = {
    async resolve(input) {
      calls.push(["resolve", input]);
      return resolve ? resolve({ calls, generation }) : source();
    }
  };
  const compilerRegistry = {
    has: (modality) => modality === "semantic_graph",
    providerPayload(modality) { calls.push(["providerPayload", modality]); return { schema: {}, schemaName: "proposal", prompt: "bounded" }; },
    async compile(input) {
      calls.push(["compile", input]);
      return compile ? compile(input, { calls, generation }) : artifact(input.reservation);
    }
  };
  const visualizationService = {
    async accountCapability() {
      return {
        allowed: true,
        availableModalities: ["semantic_graph"],
        enabled: true,
        explicitRequestsAllowed: true,
        quota: { available: true },
        serviceAvailable: true
      };
    },
    async generate(_subjectId, input, context) {
      calls.push(["generate", input, context]);
      if (generate) return generate(input, context, { calls, generation });
      reservationSequence += 1;
      return {
        reservation: {
          artifactId: `result-${reservationSequence}`,
          reservationId: `reservation-${reservationSequence}`,
          routeId: "route-1",
          routeRevision: 1
        },
        result: { text: "{}" }
      };
    },
    async rollbackGeneratedReservation(_subjectId, reservationId, error) {
      calls.push(["rollback", reservationId, error.code ?? error.message]);
    },
    async submit(_subjectId, input, context) {
      calls.push(["submit", input, context]);
      if (submit) return submit(input, context, { calls, generation });
      return { artifact: input.artifact };
    }
  };
  const worker = new VisualizationOrchestrationWorker({
    compilerRegistry,
    generationRepository: generation.value,
    queueMicrotaskImpl() {},
    sourceResolver,
    visualizationService,
    workerId: "worker-1"
  });
  return { calls, generation, worker };
}

test("generates and publishes one independently reserved artifact", async () => {
  const instance = harness();
  const result = await instance.worker.drainOne();
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.resultArtifactIds, ["result-1"]);
  const generation = instance.calls.find(([name]) => name === "generate")[1];
  assert.equal(generation.reservation.idempotencyKey, "request-1:artifact:0");
  assert.equal(generation.reservation.requestedBy, "explicit");
  const submission = instance.calls.find(([name]) => name === "submit")[1];
  assert.equal(submission.artifact.body.artifactId, "result-1");
  assert.match(submission.artifact.specHash, /^[a-f0-9]{64}$/);
  assert.match(submission.artifact.evidenceHash, /^[a-f0-9]{64}$/);
});

test("uses one reservation idempotency key for each requested artifact", async () => {
  const instance = harness({ requestedArtifactCount: 2 });
  const result = await instance.worker.drainOne();
  assert.deepEqual(result.resultArtifactIds, ["result-1", "result-2"]);
  assert.deepEqual(
    instance.calls.filter(([name]) => name === "generate").map(([, input]) => input.reservation.idempotencyKey),
    ["request-1:artifact:0", "request-1:artifact:1"]
  );
  assert.equal(instance.calls.filter(([name]) => name === "submit").length, 2);
});

test("rolls back compiler rejection before failing the request", async () => {
  const instance = harness({ compile: async () => { throw coded("visualization_proposal_invalid"); } });
  const result = await instance.worker.drainOne();
  assert.equal(result.status, "failed");
  assert.equal(result.reasonCode, "validation_failed");
  assert.deepEqual(instance.calls.find(([name]) => name === "rollback").slice(1), ["reservation-1", "visualization_validation_failed"]);
  assert.equal(instance.calls.some(([name]) => name === "submit"), false);
});

test("cancellation wins before provider, during provider, and after provider before publication", async (t) => {
  await t.test("before provider", async () => {
    let resolutions = 0;
    const instance = harness({ resolve: ({ generation }) => {
      resolutions += 1;
      if (resolutions === 1) generation.row.state = "cancel_requested";
      return source();
    } });
    const result = await instance.worker.drainOne();
    assert.equal(result.status, "cancelled");
    assert.equal(instance.calls.some(([name]) => name === "generate"), false);
  });

  await t.test("during provider", async () => {
    let started;
    const providerStarted = new Promise((resolveStarted) => { started = resolveStarted; });
    const instance = harness({ generate: async (_input, context) => new Promise((_resolve, reject) => {
      started();
      context.signal.addEventListener("abort", () => reject(coded("visualization_request_aborted")), { once: true });
    }) });
    const draining = instance.worker.drainOne();
    await providerStarted;
    instance.generation.row.state = "cancel_requested";
    instance.worker.abort("user-1", "request-1");
    const result = await draining;
    assert.equal(result.status, "cancelled");
  });

  await t.test("after provider", async () => {
    const instance = harness({ compile: async (input, { generation }) => {
      generation.row.state = "cancel_requested";
      return artifact(input.reservation);
    } });
    const result = await instance.worker.drainOne();
    assert.equal(result.status, "cancelled");
    assert.equal(instance.calls.some(([name]) => name === "submit"), false);
    assert.equal(instance.calls.some(([name]) => name === "rollback"), true);
  });
});

test("fails stale source before provider and preserves one artifact on a two-output partial failure", async () => {
  const stale = harness({ resolve: () => source({ artifactRevision: 3 }) });
  assert.equal((await stale.worker.drainOne()).reasonCode, "stale_artifact");
  assert.equal(stale.calls.some(([name]) => name === "generate"), false);

  let generationCount = 0;
  const partial = harness({
    requestedArtifactCount: 2,
    generate: async () => {
      generationCount += 1;
      if (generationCount === 2) throw coded("visualization_provider_unavailable");
      return {
        reservation: { artifactId: "result-1", reservationId: "reservation-1", routeId: "route-1", routeRevision: 1 },
        result: { text: "{}" }
      };
    }
  });
  const result = await partial.worker.drainOne();
  assert.equal(result.status, "succeeded");
  assert.equal(result.reasonCode, "partial_generation_failed");
  assert.deepEqual(result.resultArtifactIds, ["result-1"]);
});

test("requeues expired work and drains it exactly once", async () => {
  const instance = harness();
  instance.generation.row.state = "expired";
  const result = await instance.worker.recover();
  assert.equal(result.drained, 1);
  assert.equal(instance.calls.filter(([name]) => name === "generate").length, 1);
  assert.equal(instance.generation.calls.filter(([name]) => name === "requeueExpired").length, 1);
});

test("does not reinvoke a provider when recovery reports a terminal invocation", async () => {
  const instance = harness();
  instance.generation.row.state = "running";
  instance.generation.value.requeueExpired = async () => {
    instance.generation.row.state = "failed";
    instance.generation.row.reasonCode = "provider_result_recovery_required";
    return {
      cancelledRequestIds: [],
      failedRequestIds: ["request-1"],
      requeuedRequestIds: []
    };
  };
  const result = await instance.worker.recover();
  assert.equal(result.drained, 0);
  assert.equal(instance.calls.some(([name]) => name === "generate"), false);
});
