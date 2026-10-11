import { afterEach, describe, expect, test, vi } from "vitest";
import { auditAssistantAnswer } from "../app/features/assistant/answerAuditor";
import { createHttpModelAuditClient } from "../app/features/models/modelAuditClient";

const request = {
  answer: "The treatment always improves survival for every patient.",
  citations: [{ paperId: "paper-1", page: 2, snippet: "No improvement in survival was observed." }],
  retrievalConfidence: 0.84,
  model: "gpt-5-mini-auditor",
  provider: "openai",
  question: "Does treatment improve survival?"
};
const remotePayload = { audit: { model: "gpt-5-mini-auditor", score: 0.99, verdict: "pass", rationale: "Everything is supported." } };
afterEach(() => vi.useRealTimers());

describe("audit truth boundaries", () => {
  test.each([
    ["contradiction", request.citations],
    ["unrelated", [{ paperId: "paper-1", page: 2, snippet: "The butterfly has blue wings." }]],
    ["zero evidence", []]
  ])("does not certify semantic support from a high retrieval score: %s", (_, citations) => {
    const result = auditAssistantAnswer({ ...request, citations });
    expect(result).toMatchObject({ model: "structural_rules", checkerKind: "structural_rules", status: "completed", semanticStatus: "unverified" });
    expect(result.verdict).not.toBe("pass");
    expect(result.rationale).not.toContain("覆盖问题关键词");
  });

  test("treats legacy model identity and pass as unverified remote claims", async () => {
    const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async () => ({ ok: true, status: 200, json: async () => remotePayload }) });
    expect(await client(request)).toMatchObject({ model: "remote_service", checkerKind: "remote_service", status: "completed", semanticStatus: "unverified", verdict: "review", reportedModel: "gpt-5-mini-auditor" });
  });

  test.each([NaN, Infinity, -1, 2])("rejects invalid score %s", async (score) => {
    const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async () => ({ ok: true, status: 200, json: async () => ({ audit: { ...remotePayload.audit, score } }) }) });
    await expect(client(request)).rejects.toMatchObject({ reason: "invalid_response" });
  });

  test("classifies HTTP failures without trusting their body", async () => {
    const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async () => ({ ok: false, status: 500, json: async () => remotePayload }) });
    await expect(client(request)).rejects.toMatchObject({ reason: "http_error", status: "failed" });
  });

  test("classifies malformed JSON", async () => {
    const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("private provider body"); } }) });
    await expect(client(request)).rejects.toMatchObject({ reason: "invalid_response", status: "failed" });
  });

  test("bounds a stalled transport even if it ignores abort", async () => {
    vi.useFakeTimers();
    const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async () => new Promise(() => {}) });
    const assertion = expect(client(request)).rejects.toMatchObject({ reason: "timeout", status: "timed_out" });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

test("records remote failure while retaining local structural provenance", async () => {
  const { auditWithRemoteFailure, ModelAuditError } = await import("../app/features/models/modelAuditClient");
  const local = auditAssistantAnswer(request);
  expect(auditWithRemoteFailure(local, new ModelAuditError("timeout"))).toMatchObject({
    checkerKind: "structural_rules", status: "timed_out", semanticStatus: "unverified",
    remoteAttempt: { status: "timed_out", reason: "timeout" }, verdict: "review"
  });
});

test("propagates cancellation, aborts transport, and removes its timeout", async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  let transportSignal: AbortSignal | undefined;
  const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async (input) => {
    transportSignal = input.signal;
    return new Promise(() => {});
  } });
  const assertion = expect(client({ ...request, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  await assertion;
  expect(transportSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test("bounds a stalled response body as well as the HTTP request", async () => {
  vi.useFakeTimers();
  const client = createHttpModelAuditClient({ endpoint: "https://example.test", source: "cloud_proxy", transport: async () => ({ ok: true, status: 200, json: async () => new Promise(() => {}) }) });
  const assertion = expect(client(request)).rejects.toMatchObject({ status: "timed_out" });
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
});
