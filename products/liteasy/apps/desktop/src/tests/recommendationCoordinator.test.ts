import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { RecommendationFeedCoordinator, isRecommendationHidden } from "../app/features/recommendations/recommendationCoordinator";
const item = { id: "a", title: "Attention mechanisms", relevanceScore: .9, relevanceBand: "high" as const, source: "crossref", reason: "Metadata", discoveredAt: "2026-10-14", relatedDocumentTitle: "Attention" };
function setup() { const scope = crypto.randomUUID(); const storage = createObjectStorage(scope, () => scope); return { storage, scope, key: "feed", provider: "provider", now: () => Date.now() }; }
test("fresh snapshots skip discovery and models, including independent coordinators", async () => {
  const options = setup(), run = vi.fn(async () => [item]);
  const first = new RecommendationFeedCoordinator(options);
  await first.refresh("initial", run);
  const second = new RecommendationFeedCoordinator(options);
  await second.refresh("initial", run);
  expect(run).toHaveBeenCalledTimes(1); expect((await second.read()).current?.items).toHaveLength(1);
});
test("saved schedule and unread limits take effect without replacing the feed", async () => {
  let hours = 0, cap = 9;
  const coordinator = new RecommendationFeedCoordinator({ ...setup(), automaticHours: () => hours, unreadCap: () => cap });
  const run = vi.fn(async () => [item]);
  await coordinator.refresh("initial", run); expect(run).not.toHaveBeenCalled();
  await coordinator.feedback(item.id, "saved"); hours = 24; cap = 1;
  await coordinator.refresh("scheduled", run); expect(run).not.toHaveBeenCalled();
  cap = 9;
  await coordinator.refresh("scheduled", run); expect(run).toHaveBeenCalledTimes(1);
  expect((await coordinator.read()).saved).toContain(item.id);
});
test("negative feedback stays within its topic and undo does not request replacements", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), run = vi.fn(async () => [item]);
  await coordinator.refresh("initial", run);
  await coordinator.recordFeedback(item.id, "not_relevant", "snapshot", "Attention");
  const state = await coordinator.read();
  expect(isRecommendationHidden(item, state)).toBe(true);
  expect(isRecommendationHidden({ ...item, relatedDocumentTitle: "Databases" }, state)).toBe(false);
  await coordinator.recordFeedback(item.id, "undo", "snapshot", "Attention");
  expect(isRecommendationHidden(item, await coordinator.read())).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});
test("durable lease coalesces concurrent windows and clear fences a late reply", async () => {
  const options = setup(); const first = new RecommendationFeedCoordinator(options), second = new RecommendationFeedCoordinator(options);
  let resolve!: (value: typeof item[]) => void;
  const run = vi.fn(() => new Promise<typeof item[]>(r => { resolve = r; }));
  const pending = first.refresh("manual_check", run);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  await second.refresh("manual_check", run); expect(run).toHaveBeenCalledTimes(1);
  await second.clear(); resolve([item]); await pending;
  expect((await first.read()).current).toBeUndefined();
});
test("scheduled results remain pending, failure preserves same-scope snapshot", async () => {
  let now = Date.now(); const options = { ...setup(), now: () => now };
  const coordinator = new RecommendationFeedCoordinator(options);
  await coordinator.refresh("initial", async () => [item]);
  now += 25 * 3600000;
  await coordinator.refresh("scheduled", async () => [{ ...item, id: "b" }]);
  expect((await coordinator.read()).current?.items[0].id).toBe("a");
  expect((await coordinator.read()).pending?.items[0].id).toBe("b");
  await coordinator.acceptPending();
  await coordinator.refresh("manual_check", async () => { throw new Error("offline"); });
  expect((await coordinator.read()).current?.items[0].id).toBe("b");
});
test("provider requests are reserved across workspaces before sending", async () => {
  const options = setup(); const a = new RecommendationFeedCoordinator(options), b = new RecommendationFeedCoordinator({ ...options, key: "second" });
  const calls = vi.fn(async () => {});
  const run = async (task: Parameters<Parameters<typeof a.refresh>[1]>[0]) => { for (let i = 0; i < 20; i++) { try { await task.request("provider", calls); } catch { break; } } return [item]; };
  await a.refresh("manual_check", run); expect(calls).toHaveBeenCalledTimes(6);
  await b.refresh("manual_check", run); expect(calls).toHaveBeenCalledTimes(12);
  await a.refresh("manual_check", run); expect(calls).toHaveBeenCalledTimes(12);
});
test("source revision changes and cleared cache cannot resurrect feedback or private explanations", async () => {
  let revision = "one"; const coordinator = new RecommendationFeedCoordinator({ ...setup(), sourceRevision: () => revision });
  await coordinator.refresh("manual_check", async () => [{ ...item, contextEvidence: [{ id: "note" }] } as typeof item]);
  revision = "two"; await coordinator.invalidateEvidence();
  expect((await coordinator.read()).current?.items).toEqual([]);
  await coordinator.feedback(item.id, "dismissed"); await coordinator.clear();
  expect((await coordinator.read()).hidden).toContain(item.id);
});
test("parallel reservations never exceed the six-request task cap", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), send = vi.fn(async () => {});
  await coordinator.refresh("manual_check", async task => {
    for (let i = 0; i < 4; i++) await task.request("provider", send);
    await Promise.allSettled(Array.from({ length: 12 }, () => task.request("provider", send)));
    return [item];
  });
  expect(send.mock.calls.length).toBeLessThanOrEqual(6);
});
test("429 cooldown is shared by provider across workspaces and retains cached cards", async () => {
  const options = setup(), coordinator = new RecommendationFeedCoordinator(options), send = vi.fn(async () => { throw Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 300000 }); });
  await coordinator.refresh("manual_check", async () => [item]);
  await coordinator.refresh("manual_check", task => task.request("provider", send));
  expect((await coordinator.read()).current?.items[0].id).toBe(item.id);
  await new RecommendationFeedCoordinator({ ...options, key: "other" }).refresh("manual_check", task => task.request("provider", send));
  expect(send).toHaveBeenCalledTimes(1);
});
test("task deadline returns cached cards even when a provider ignores cancellation", async () => {
  const coordinator = new RecommendationFeedCoordinator({ ...setup(), deadlineMs: 200 });
  await coordinator.refresh("manual_check", async () => [item]);
  let finish!: (items: typeof item[]) => void;
  const pending = coordinator.refresh("manual_check", async () => new Promise<typeof item[]>(resolve => { finish = resolve; }));
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await pending;
  expect((await coordinator.read()).current?.items[0].id).toBe("a");
  finish([{ ...item, id: "late" }]); await Promise.resolve();
  expect((await coordinator.read()).current?.items[0].id).toBe("a");
});
test("changing a policy/feed identity cannot multiply automatic work in one workspace", async () => {
  const options = { ...setup(), workspaceId: "workspace" }, run = vi.fn(async () => [item]);
  await new RecommendationFeedCoordinator(options).refresh("initial", run);
  await new RecommendationFeedCoordinator({ ...options, key: "new-policy", provider: "other-key" }).refresh("initial", run);
  expect(run).toHaveBeenCalledTimes(1);
  await new RecommendationFeedCoordinator({ ...options, key: "new-policy", provider: "other-key" }).refresh("manual_check", run);
  expect(run).toHaveBeenCalledTimes(2);
});
test("another window clearing the task propagates AbortSignal to the running provider", async () => {
  const options = setup(), first = new RecommendationFeedCoordinator(options), other = new RecommendationFeedCoordinator(options);
  let signal: AbortSignal | undefined;
  const pending = first.refresh("manual_check", task => new Promise((_, reject) => { signal = task.signal; task.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }); }));
  await vi.waitFor(() => expect(signal).toBeDefined()); await other.clear();
  await vi.waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 2000 }); await pending;
  expect((await first.read()).current).toBeUndefined();
});
