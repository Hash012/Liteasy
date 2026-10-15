import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { RECOMMENDATION_AI_BUDGET as budget } from "../app/features/recommendations/recommendationAiBudget";
import { RecommendationFeedCoordinator, isRecommendationHidden } from "../app/features/recommendations/recommendationCoordinator";
const item = { id: "a", title: "Attention mechanisms", relevanceScore: .9, relevanceBand: "high" as const, source: "crossref", reason: "Metadata", discoveredAt: "2026-10-14", relatedDocumentTitle: "Attention", facetId: "facet-a" };
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
  const receipt = await coordinator.recordFeedback(item.id, "not_relevant", "snapshot", "facet-a");
  const state = await coordinator.read();
  expect(isRecommendationHidden(item, state)).toBe(true);
  expect(isRecommendationHidden({ ...item, relatedDocumentTitle: "Attention", facetId: "facet-b" }, state)).toBe(false);
  await coordinator.recordFeedback(item.id, "undo", "snapshot", "facet-a", { commandId: crypto.randomUUID(), issuedAt: Date.now(), targetEventId: receipt.eventId });
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
test("automatic provider requests retain the shared daily allowance", async () => {
  const options = setup(); const a = new RecommendationFeedCoordinator(options), b = new RecommendationFeedCoordinator({ ...options, key: "second" });
  const calls = vi.fn(async () => {});
  const run = async (task: Parameters<Parameters<typeof a.refresh>[1]>[0]) => { for (let i = 0; i < 20; i++) { try { await task.request("provider", calls); } catch { break; } } return [item]; };
  await a.refresh("initial", run); expect(calls).toHaveBeenCalledTimes(6);
  await b.refresh("initial", run); expect(calls).toHaveBeenCalledTimes(12);
  await new RecommendationFeedCoordinator({ ...options, key: "third" }).refresh("initial", run); expect(calls).toHaveBeenCalledTimes(12);
  await a.refresh("manual_check", run); expect(calls).toHaveBeenCalledTimes(32);
});
test("source revision changes and cleared cache cannot resurrect feedback or private explanations", async () => {
  let revision = "one"; const coordinator = new RecommendationFeedCoordinator({ ...setup(), sourceRevision: () => revision });
  await coordinator.refresh("manual_check", async () => [{ ...item, contextEvidence: [{ id: "note" }] } as typeof item]);
  revision = "two"; await coordinator.invalidateEvidence();
  expect((await coordinator.read()).current?.items).toEqual([]);
  await coordinator.feedback(item.id, "dismissed"); await coordinator.clear();
  expect((await coordinator.read()).hidden).toContain(item.id);
});
test("parallel reservations never exceed the automatic six-request task cap", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), send = vi.fn(async () => {});
  await coordinator.refresh("initial", async task => {
    for (let i = 0; i < 4; i++) await task.request("provider", send);
    await Promise.allSettled(Array.from({ length: 12 }, () => task.request("provider", send)));
    return [item];
  });
  expect(send.mock.calls.length).toBeLessThanOrEqual(6);
});

test("manual AI curation supports three bounded batches on repeated user requests", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), send = vi.fn(async () => {});
  for (let attempt = 0; attempt < 4; attempt++) await coordinator.refresh("ai_curate", async task => {
    for (let batch = 0; batch < 3; batch++) await task.request("generation", send, 12000);
    await expect(task.request("generation", send, 100)).rejects.toThrow("单次处理上限");
    return [item];
  });
  expect(send).toHaveBeenCalledTimes(12);
  expect((await coordinator.read()).current?.selection).toBe("ai");
});

test("AI batches cannot exceed either single request or combined token bounds", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), send = vi.fn(async () => {});
  await coordinator.refresh("ai_curate", async task => {
    await expect(task.request("generation", send, budget.maxRequestTokens + 1)).rejects.toThrow("单次处理上限");
    for (let batch = 0; batch < budget.maxBatches; batch++) await task.request("generation", send, budget.maxRequestTokens);
    await expect(task.request("generation", send, 1)).rejects.toThrow("单次处理上限");
    return [item];
  });
  expect(send).toHaveBeenCalledTimes(budget.maxBatches);
  expect((await coordinator.read()).usage?.generationReservedTokens).toBeLessThanOrEqual(budget.maxRunTokens);
});

test("manual content retrieval is bounded per task without a hidden daily lockout", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), send = vi.fn(async () => {});
  for (let attempt = 0; attempt < 2; attempt++) await coordinator.refresh("ai_curate", async task => {
    for (let request = 0; request < 48; request++) await task.request("provider", send);
    await expect(task.request("provider", send)).rejects.toThrow("单次处理上限");
    return [item];
  });
  expect(send).toHaveBeenCalledTimes(96);
});

test("an AI task remains valid after content retrieval takes more than 45 seconds", async () => {
  let now = Date.now();
  const coordinator = new RecommendationFeedCoordinator({ ...setup(), now: () => now });
  await coordinator.refresh("ai_curate", async task => {
    now += 60_000;
    expect(await task.active()).toBe(true);
    await task.request("generation", async () => {}, 2000);
    return [item];
  });
  expect((await coordinator.read()).current?.items).toEqual([item]);
});

test("correcting authentication works immediately and rate limits only block their own source", async () => {
  const coordinator = new RecommendationFeedCoordinator(setup()), send = vi.fn(async () => {});
  await coordinator.refresh("ai_curate", async task => {
    await expect(task.request("provider", async () => { throw Object.assign(new Error("invalid key"), { status: 401 }); }, 0, "configured")).rejects.toThrow("invalid key");
    await task.request("provider", send, 0, "configured");
    await expect(task.request("provider", async () => { throw Object.assign(new Error("rate limited"), { status: 429 }); }, 0, "configured")).rejects.toThrow("rate limited");
    await expect(task.request("provider", send, 0, "configured")).rejects.toThrow("请求较频繁");
    await task.request("provider", send, 0, "crossref-public");
    return [item];
  });
  expect(send).toHaveBeenCalledTimes(2);
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

test("revocation during reservation prevents the HTTP request and releases its slot", async () => {
  const options = setup(), send = vi.fn(async () => {});
  let coordinator!: RecommendationFeedCoordinator, cancelled = false;
  const storage = { ...options.storage, commit: async (...args: Parameters<typeof options.storage.commit>) => {
    const result = await options.storage.commit(...args);
    if (!cancelled && args[0].some(change => change.key.endsWith("budget/models") && (change.row?.value as { active?: unknown[] })?.active?.length)) {
      cancelled = true; coordinator.cancel();
    }
    return result;
  } };
  coordinator = new RecommendationFeedCoordinator({ ...options, storage });
  await coordinator.refresh("ai_curate", async task => { await task.request("generation", send, 1000); return [item]; });
  expect(send).not.toHaveBeenCalled();
  // The aborted run's late cleanup finishes before the next explicit request.
  await new Promise(resolve => setTimeout(resolve, 20));
  await coordinator.refresh("ai_curate", async task => { await task.request("generation", send, 1000); return [item]; });
  expect(send).toHaveBeenCalledOnce();
});
