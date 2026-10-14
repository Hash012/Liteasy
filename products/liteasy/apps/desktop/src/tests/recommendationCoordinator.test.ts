import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { RecommendationFeedCoordinator } from "../app/features/recommendations/recommendationCoordinator";
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
