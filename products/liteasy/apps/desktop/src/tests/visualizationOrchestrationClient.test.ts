import { beforeEach, expect, test, vi } from "vitest";
import type { ThinReadingVisualizationGenerationRequest } from "../app/features/artifacts/artifact.types";
import {
  createVisualizationOrchestrationClient,
  VisualizationOrchestrationClientError
} from "../app/features/visualization/visualizationOrchestrationClient";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";

const capability = {
  allowed: true,
  availableModalities: ["semantic_graph" as const],
  enabled: true,
  explicitRequestsAllowed: true,
  quota: { available: true },
  serviceAvailable: true
};

function generation(signal = new AbortController().signal): ThinReadingVisualizationGenerationRequest {
  return {
    artifactId: "artifact-1",
    candidateModalities: ["semantic_graph"],
    evidenceIds: ["evidence-1"],
    nodeId: "node-1",
    purpose: "explain_structure",
    requestId: "request-1",
    requestedArtifactCount: 1,
    signal
  };
}

function response(payload: unknown, status = 200) {
  return {
    async json() { return payload; },
    ok: status >= 200 && status < 300,
    status
  };
}

function artifact() {
  return { ...makeVisualizationArtifactFixture(), artifactId: "result-1", nodeId: "node-1" };
}

beforeEach(() => window.localStorage.clear());

test("persists before authenticated POST, sends only coordinates, and parses terminal artifacts", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const client = createVisualizationOrchestrationClient({
    endpoint: "https://api.example/",
    fetchImpl: async (url, init) => {
      requests.push({ init, url });
      expect(client.pending()).toHaveLength(1);
      return response({
        artifacts: [artifact()],
        requestId: "request-1",
        resultArtifactIds: ["result-1"],
        status: "succeeded"
      });
    },
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    storage: window.localStorage,
    subjectId: "user-1"
  });
  const result = await client.startAndWait(generation());
  expect(result.map(({ artifactId }) => artifactId)).toEqual(["result-1"]);
  expect(client.pending()).toEqual([]);
  expect(requests[0].url).toBe("https://api.example/v1/account/visualization/requests");
  expect(requests[0].init?.headers).toEqual({
    Accept: "application/json",
    Authorization: "Bearer token-1",
    "Content-Type": "application/json"
  });
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({
    artifactId: "artifact-1",
    nodeId: "node-1",
    requestId: "request-1",
    requestedArtifactCount: 1
  });
});

test("polls active requests with server delay clamped to 250..2000", async () => {
  const delays: number[] = [];
  const payloads = [
    { requestId: "request-1", resultArtifactIds: [], retryAfterMs: 1, status: "queued" },
    { requestId: "request-1", resultArtifactIds: [], retryAfterMs: 9_000, status: "running" },
    { artifacts: [artifact()], requestId: "request-1", resultArtifactIds: ["result-1"], status: "succeeded" }
  ];
  const client = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async () => response(payloads.shift()),
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    setTimeoutImpl: ((callback: TimerHandler, delay?: number) => {
      delays.push(Number(delay));
      queueMicrotask(() => typeof callback === "function" && callback());
      return 1;
    }) as typeof setTimeout,
    storage: window.localStorage,
    subjectId: "user-1"
  });
  await expect(client.startAndWait(generation())).resolves.toHaveLength(1);
  expect(delays).toEqual([250, 2_000]);
});

test("refreshes an expired token and retries the visualization request once", async () => {
  const authorizations: string[] = [];
  const refreshAccessToken = vi.fn(async () => "token-2");
  const client = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async (_url, init) => {
      const authorization = String((init?.headers as Record<string, string>).Authorization);
      authorizations.push(authorization);
      return authorization === "Bearer token-2"
        ? response({
            artifacts: [artifact()],
            requestId: "request-1",
            resultArtifactIds: ["result-1"],
            status: "succeeded"
          })
        : response({ code: "unauthorized" }, 401);
    },
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    refreshAccessToken,
    storage: window.localStorage,
    subjectId: "user-1"
  });
  await expect(client.startAndWait(generation())).resolves.toHaveLength(1);
  expect(authorizations).toEqual(["Bearer token-1", "Bearer token-2"]);
  expect(refreshAccessToken).toHaveBeenCalledTimes(1);
});

test.each([
  ["capability_unauthorized", "capability_unavailable"],
  ["quota_exhausted", "quota_unavailable"],
  ["stale_artifact", "stale_request"],
  ["evidence_invalid", "result_invalid"],
  ["provider_unavailable", "service_unavailable"],
  ["internal_failure", "generation_failed"]
])("maps terminal %s without exposing server detail", async (serverReason, expected) => {
  const client = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async () => response({
      reasonCode: serverReason,
      requestId: "request-1",
      resultArtifactIds: [],
      status: "omitted"
    }),
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    storage: window.localStorage,
    subjectId: "user-1"
  });
  await expect(client.startAndWait(generation())).rejects.toMatchObject({ reasonCode: expected });
  expect(client.pending()).toEqual([]);
});

test("aborts polling while retaining recovery coordinates", async () => {
  const controller = new AbortController();
  const client = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async () => response({ requestId: "request-1", resultArtifactIds: [], status: "queued" }),
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    setTimeoutImpl: (() => 1) as typeof setTimeout,
    storage: window.localStorage,
    subjectId: "user-1"
  });
  const result = client.startAndWait(generation(controller.signal));
  await Promise.resolve();
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(client.pending()).toHaveLength(1);
});

test("uses a separate bounded cancel request and clears only confirmed cancellation", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const client = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async (url, init) => {
      requests.push({ init, url });
      return response({ requestId: "request-1", resultArtifactIds: [], status: "cancelled" });
    },
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    storage: window.localStorage,
    subjectId: "user-1"
  });
  window.localStorage.clear();
  await client.cancel({ artifactId: "artifact-1", nodeId: "node-1", reason: "user_cancelled", requestId: "request-1" });
  expect(requests[0].url).toContain("/request-1/cancel");
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({
    idempotencyKey: "request-1:cancel:user_cancelled"
  });
});

test("fails closed on 401, malformed artifact, and local capability denial", async () => {
  let calls = 0;
  const unauthorized = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async () => { calls += 1; return response({ code: "private" }, 401); },
    getAccessToken: () => "expired",
    getCapability: () => capability,
    storage: window.localStorage,
    subjectId: "user-1"
  });
  await expect(unauthorized.startAndWait(generation())).rejects.toBeInstanceOf(VisualizationOrchestrationClientError);

  const malformed = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async () => response({
      artifacts: [{ artifactId: "result-1" }],
      requestId: "request-1",
      resultArtifactIds: ["result-1"],
      status: "succeeded"
    }),
    getAccessToken: () => "token-1",
    getCapability: () => capability,
    storage: window.localStorage,
    subjectId: "user-2"
  });
  await expect(malformed.startAndWait(generation())).rejects.toMatchObject({ reasonCode: "result_invalid" });

  const denied = createVisualizationOrchestrationClient({
    endpoint: "https://api.example",
    fetchImpl: async () => { calls += 1; return response({}); },
    getAccessToken: () => "token-1",
    getCapability: () => ({ ...capability, allowed: false }),
    storage: window.localStorage,
    subjectId: "user-3"
  });
  await expect(denied.startAndWait(generation())).rejects.toMatchObject({ reasonCode: "capability_unavailable" });
  expect(calls).toBe(1);
});
