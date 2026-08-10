import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { IdentityError } from "./identityVerifier.mjs";
import { handleVisualizationRequest } from "./visualizationRoutes.mjs";

function request(method = "GET", authorization = "Bearer desktop") {
  const value = new EventEmitter();
  value.headers = { authorization };
  value.method = method;
  return value;
}

function harness(overrides = {}) {
  const calls = [];
  const runtime = {
    identityVerifier: {
      async verifyAuthorizationHeader(header, audience) {
        calls.push(["identity", header, audience]);
        return { subject: "user-1" };
      }
    },
    visualizationOrchestrationService: {
      async cancel(subjectId, requestId, input, traceId) {
        calls.push(["cancel", subjectId, requestId, input, traceId]);
        return { requestId, resultArtifactIds: [], status: "cancelled" };
      },
      async start(subjectId, input, traceId) {
        calls.push(["start", subjectId, input, traceId]);
        return { requestId: input.requestId, resultArtifactIds: [], retryAfterMs: 500, status: "queued" };
      },
      async status(subjectId, requestId) {
        calls.push(["status", subjectId, requestId]);
        return {
          artifacts: [{ artifactId: "result-1", artifactVersion: "liteasy.visualization/v1" }],
          requestId,
          resultArtifactIds: ["result-1"],
          status: "succeeded"
        };
      }
    },
    ...overrides.runtime
  };
  const readJsonBody = overrides.readJsonBody ?? (async (_request, maximumBytes) => {
    calls.push(["readJsonBody", maximumBytes]);
    return overrides.body ?? {};
  });
  const sendJson = (_response, status, body) => calls.push(["sendJson", status, body]);
  async function handle(method, pathname, authorization) {
    const requestValue = request(method, authorization);
    const handled = await handleVisualizationRequest({
      config: { identity: {} },
      readJsonBody,
      request: requestValue,
      response: {},
      runtime,
      sendJson,
      traceId: "trace-1",
      url: new URL(pathname, "https://api.example")
    });
    return { handled, request: requestValue };
  }
  return { calls, handle, runtime };
}

test("authenticates before reading a strict bounded start body and returns 202 while active", async () => {
  const body = {
    artifactId: "artifact-1",
    nodeId: "node-1",
    requestId: "request-1",
    requestedArtifactCount: 1
  };
  const instance = harness({ body });
  assert.equal((await instance.handle("POST", "/v1/account/visualization/requests")).handled, true);
  assert.deepEqual(instance.calls.map(([name]) => name), ["identity", "readJsonBody", "start", "sendJson"]);
  assert.deepEqual(instance.calls[0], ["identity", "Bearer desktop", "liteasy-desktop"]);
  assert.deepEqual(instance.calls[1], ["readJsonBody", 16 * 1024]);
  assert.deepEqual(instance.calls[2], ["start", "user-1", body, "trace-1"]);
  assert.equal(instance.calls[3][1], 202);
});

test("returns 200 for terminal replay and rejects subject or unknown authority fields", async () => {
  const terminal = harness({
    body: { artifactId: "artifact-1", nodeId: "node-1", requestId: "request-1", requestedArtifactCount: 1 },
    runtime: { visualizationOrchestrationService: {
      async start(_subjectId, input) {
        return { reasonCode: "modality_unavailable", requestId: input.requestId, resultArtifactIds: [], status: "omitted" };
      }
    } }
  });
  await terminal.handle("POST", "/v1/account/visualization/requests");
  assert.equal(terminal.calls.at(-1)[1], 200);

  for (const body of [
    { artifactId: "artifact-1", nodeId: "node-1", requestId: "request-1", requestedArtifactCount: 1, subjectId: "user-2" },
    { artifactId: "artifact-1", nodeId: "node-1", requestId: "request-1", requestedArtifactCount: 1, evidenceIds: ["evidence-1"] }
  ]) {
    const invalid = harness({ body });
    await assert.rejects(
      () => invalid.handle("POST", "/v1/account/visualization/requests"),
      /visualization_request_invalid/
    );
    assert.equal(invalid.calls.some(([name]) => name === "start"), false);
  }
});

test("binds status and cancellation to the desktop subject and strict path/body contracts", async () => {
  const status = harness();
  await status.handle("GET", "/v1/account/visualization/requests/request-1");
  assert.deepEqual(status.calls.find(([name]) => name === "status"), ["status", "user-1", "request-1"]);
  assert.equal(status.calls.at(-1)[1], 200);

  const cancellation = harness({ body: { idempotencyKey: "request-1:cancel:user" } });
  await cancellation.handle("POST", "/v1/account/visualization/requests/request-1/cancel");
  assert.deepEqual(cancellation.calls.find(([name]) => name === "cancel"), [
    "cancel", "user-1", "request-1", { idempotencyKey: "request-1:cancel:user" }, "trace-1"
  ]);
  assert.deepEqual(cancellation.calls.find(([name]) => name === "readJsonBody"), ["readJsonBody", 16 * 1024]);

  const invalid = harness({ body: { idempotencyKey: "request-1:cancel", reason: "user" } });
  await assert.rejects(
    () => invalid.handle("POST", "/v1/account/visualization/requests/request-1/cancel"),
    /visualization_cancel_invalid/
  );
  assert.equal(invalid.calls.some(([name]) => name === "cancel"), false);
});

test("fails authentication before body access and never treats disconnect as durable cancellation", async () => {
  let read = false;
  const unauthorized = harness({
    readJsonBody: async () => { read = true; return {}; },
    runtime: { identityVerifier: {
      async verifyAuthorizationHeader() { throw new IdentityError("access_token_invalid", 401); }
    } }
  });
  await assert.rejects(
    () => unauthorized.handle("POST", "/v1/account/visualization/requests", "Bearer service"),
    /access_token_invalid/
  );
  assert.equal(read, false);

  let resolveStart;
  const pending = new Promise((resolve) => { resolveStart = resolve; });
  const disconnected = harness({
    body: { artifactId: "artifact-1", nodeId: "node-1", requestId: "request-1", requestedArtifactCount: 1 },
    runtime: { visualizationOrchestrationService: {
      async start() { return pending; },
      async cancel() { throw new Error("cancel_must_be_explicit"); }
    } }
  });
  const requestValue = request("POST");
  const handling = handleVisualizationRequest({
    config: { identity: {} },
    readJsonBody: async () => disconnected.calls.length && {
      artifactId: "artifact-1", nodeId: "node-1", requestId: "request-1", requestedArtifactCount: 1
    },
    request: requestValue,
    response: {},
    runtime: disconnected.runtime,
    sendJson() {},
    traceId: "trace-1",
    url: new URL("https://api.example/v1/account/visualization/requests")
  });
  requestValue.emit("aborted");
  resolveStart({ requestId: "request-1", resultArtifactIds: [], status: "queued" });
  assert.equal(await handling, true);
});
