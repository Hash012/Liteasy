import { expect, test, vi } from "vitest";
import { usePdfQuickAskController } from "../app/controllers/usePdfQuickAskController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { DirectModelRequest } from "../app/features/models/directModelTransport";
import type { ModelTransport } from "../app/features/models/modelHttpClient";
import "fake-indexeddb/auto";
import { renderHook, act } from "@testing-library/react";
import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { createOpenAIAgentsSdkManager } from "../app/controllers/agent/createOpenAIAgentsSdkManager";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";

const source = { scopeId: "local:test", paperId: "paper", documentRevision: "sha256:paper-v1", extractorRevision: "pdf-text/v1" };
function request() { return { paper: { id: "paper", title: "Paper" }, page: 4, excerpt: "selected evidence", question: "", pageText: "selected evidence and page context", abstractText: "", source, signal: new AbortController().signal }; }
function stream(events: unknown[]) {
  return { ok: true, status: 200, json: async () => ({}), body: new ReadableStream<Uint8Array>({ start(controller) {
    for (const event of events) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); controller.close();
  } }) };
}
test("production controller uses the existing gateway once, without Agent actions or context capture", async () => {
  const wire: Record<string, unknown>[] = [];
  const transport: ModelTransport = vi.fn(async (input) => {
    wire.push(JSON.parse(input.body));
    return stream([{ type: "delta", delta: "Explanation" }, { type: "completed", answer: "Explanation", execution: { mode: "live", provider: "openai" } }]);
  });
  const onDelta = vi.fn();
  let agentAccesses = 0;
  const workbench = renderHook(() => useObjectWorkbenchController({ scopeId: source.scopeId,
    getSettings: () => createSettingsStore().getState(), getPapers: () => [request().paper],
    getApi: () => { agentAccesses++; throw new Error("Quick Ask must not access the Agent API"); }, openEvidence: () => {} }));
  const run = usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), modelTransport: transport, getScopeId: () => source.scopeId,
    // Real legacy dependencies expose regressions back to the old capture/ask route.
    capture: workbench.result.current.captureQuickAsk, ask: workbench.result.current.ask } as never);
  const oldTray = workbench.result.current.tray;
  await act(async () => { await expect(run({ ...request(), abstractText: "A real abstract", onDelta })).resolves.toBe("Explanation"); });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(onDelta).toHaveBeenCalledWith("Explanation", "Explanation");
  expect(wire[0]).not.toHaveProperty("tools");
  expect(wire[0]).not.toHaveProperty("outputFormat");
  expect(wire[0].prompt).not.toMatch(/liteasy_asset_action|read_asset|write_asset/);
  expect(wire[0].prompt).toContain("selected evidence");
  expect(agentAccesses).toBe(0);
  expect(workbench.result.current.tray).toEqual(oldTray);
  expect(workbench.result.current.answer).toBeUndefined();
  workbench.unmount();
});

test.each([
  [[{ type: "delta", delta: "partial" }], "未正常完成"],
  [[{ type: "delta", delta: "partial" }, { type: "error", message: "quota_exceeded" }], "quota_exceeded"],
  [[{ type: "delta", delta: "partial" }, { type: "completed", answer: "" }], "没有可保存"],
] as const)("partial output is never a completed answer: %j", async (events, message) => {
  const transport = vi.fn(async () => stream([...events])); const onDelta = vi.fn(); const onReceipt = vi.fn();
  const run = usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), modelTransport: transport });
  await expect(run({ ...request(), onDelta, onReceipt })).rejects.toThrow(message);
  expect(transport).toHaveBeenCalledTimes(1); expect(onDelta).toHaveBeenCalled();
  expect(onReceipt.mock.calls[0][0].terminal).toBe("incomplete");
});

test("forbidden organization source and scope mismatch are blocked before transport or extraction", async () => {
  const transport = vi.fn(); const loadContext = vi.fn(async () => []);
  const run = usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), modelTransport: transport, getScopeId: () => source.scopeId });
  await expect(run({ ...request(), paper: { ...request().paper, sourcePath: "org://team/paper.pdf" }, loadContext })).rejects.toThrow("组织");
  await expect(run({ ...request(), source: { ...source, scopeId: "different-account" }, loadContext })).rejects.toThrow("范围");
  expect(transport).not.toHaveBeenCalled(); expect(loadContext).not.toHaveBeenCalled();
});

test("a late response after account generation changes cannot publish deltas or completion", async () => {
  let generation = "account-generation-A";
  const transport = vi.fn(async () => { generation = "account-generation-B"; return stream([{ type: "delta", delta: "late" }, { type: "completed", answer: "late" }]); });
  const onDelta = vi.fn(); const onReceipt = vi.fn();
  const run = usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), modelTransport: transport, getScopeGeneration: () => generation });
  await expect(run({ ...request(), onDelta, onReceipt })).rejects.toThrow("账号");
  expect(onDelta).not.toHaveBeenCalled(); expect(onReceipt).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledTimes(1);
});

test("abort stops the transport and suppresses late chunks without retry", async () => {
  const abort = new AbortController(); let signal: AbortSignal | undefined;
  const transport = vi.fn(async (input) => { signal = input.signal; abort.abort(new Error("用户停止")); return stream([{ type: "completed", answer: "late" }]); });
  const onDelta = vi.fn(); const onReceipt = vi.fn();
  await expect(usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), modelTransport: transport })({ ...request(), signal: abort.signal, onDelta, onReceipt })).rejects.toThrow("用户停止");
  expect(signal?.aborted).toBe(true); expect(onReceipt).not.toHaveBeenCalled(); expect(onDelta).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledTimes(1);
});

test("direct providers use the same restricted gateway and require a successful stop reason", async () => {
  const settings = { ...createSettingsStore().getState(), "models.connection_mode": "direct" as const, "models.direct_provider": "deepseek", "models.direct_endpoint": "https://api.deepseek.com", "models.direct_model": "deepseek-chat", "models.direct_protocol": "openai" as const };
  const bodies: unknown[] = [];
  const transport = vi.fn(async (input: DirectModelRequest) => { bodies.push(input.body); input.onChunk?.(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"direct answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); return ""; });
  const run = usePdfQuickAskController({ getSettings: () => settings, directTransport: transport });
  expect(await run(request())).toBe("direct answer");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(bodies[0]).not.toHaveProperty("tools"); expect(bodies[0]).not.toHaveProperty("response_format");
  const incomplete = vi.fn(async (input: DirectModelRequest) => { input.onChunk?.(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: [DONE]\n\n')); return ""; });
  await expect(usePdfQuickAskController({ getSettings: () => settings, directTransport: incomplete })(request())).rejects.toThrow("完成回执");
  expect(incomplete).toHaveBeenCalledTimes(1);
});


test("legacy action route regression: normal Markdown succeeds without the real workspace Agent parsing it", async () => {
  const settings = createSettingsStore().getState();
  const wires: Record<string, unknown>[] = [];
  const transport: ModelTransport = async input => {
    wires.push(JSON.parse(input.body));
    return input.url.endsWith("/generate-stream") ? stream([{ type: "delta", delta: "**Explanation**" }, { type: "completed", answer: "**Explanation**", execution: { mode: "live", provider: "openai" } }]) : { ok: true, status: 200, json: async () => ({ answer: "**Explanation**", execution: { mode: "live", provider: "openai" } }) };
  };
  let api!: ReturnType<typeof createDesktopAgentService>;
  const workbench = renderHook(() => useObjectWorkbenchController({ scopeId: "route-regression", getSettings: () => settings,
    getPapers: () => [request().paper], getApi: () => api, openEvidence: () => {} }));
  api = createDesktopAgentService({ managerAgent: createOpenAIAgentsSdkManager(),
    resolveObjectContext: ({ request }) => workbench.result.current.resolveContext(request),
    getEnvironment: () => ({ assets: workbench.result.current.agentAssets, assetScopeId: "route-regression", runtime: {} as never,
      knowledge: { selectedPapers: [request().paper], importedChunksByPaperId: {}, settings, modelTransport: transport } }) });
  try {
    const run = usePdfQuickAskController({ getSettings: () => settings, modelTransport: transport, getScopeId: () => "route-regression",
      capture: workbench.result.current.captureQuickAsk, ask: workbench.result.current.ask } as never);
    await act(async () => { await expect(run({ ...request(), source: { ...source, scopeId: "route-regression" }, question: "解释这个选段", abstractText: "A real abstract" })).resolves.toBe("**Explanation**"); });
    expect(wires).toHaveLength(1);
    expect(wires[0]).not.toHaveProperty("outputFormat");
    expect(workbench.result.current.tray).toHaveLength(0);
  } finally { api.dispose(); workbench.unmount(); }
});

test("malformed source identity and selection ranges cannot reach extraction or the model", async () => {
  const transport = vi.fn(); const loadContext = vi.fn(async () => []);
  const run = usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), modelTransport: transport });
  await expect(run({ ...request(), source: { ...source, extractorRevision: undefined } as never, loadContext })).rejects.toThrow("范围");
  await expect(run({ ...request(), selectionSpans: [{ page: 5, precision: "range", startUtf16: 0, endUtf16: 10 }], loadContext })).rejects.toThrow("范围");
  await expect(run({ ...request(), scopeGeneration: -1, loadContext })).rejects.toThrow("范围");
  expect(loadContext).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});
