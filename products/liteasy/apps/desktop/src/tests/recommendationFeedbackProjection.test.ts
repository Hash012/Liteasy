import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { RecommendationFeedCoordinator, isRecommendationHidden } from "../app/features/recommendations/recommendationCoordinator";
import { commitFeedback, emptyFeedback, projectFeedback } from "../app/features/recommendations/recommendationFeedbackProjection";
import { rankRecommendations } from "../app/features/recommendations/recommendationRanking";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
const item: RecommendationItem = { id: "p", canonicalId: "doi:10.123/test", facetId: "facet-1", title: "Paper", relatedDocumentTitle: "Old label", reason: "", source: "crossref", discoveredAt: "2026-10-15", relevanceBand: "high", relevanceScore: .8 };
const command = (action: "read" | "snoozed" | "too_basic" | "too_advanced" | "not_relevant" | "undo", targetEventId?: string) => ({ commandId: crypto.randomUUID(), issuedAt: Date.now(), paperId: item.canonicalId!, facetId: item.facetId, action, targetEventId });
function setup() { const scope = crypto.randomUUID(); const storage = createObjectStorage(scope, () => scope); return { storage, scope, workspaceId: "workspace-1", key: "provider-a", provider: "a" }; }
test("receipts survive restart and provider changes; CAS preserves separate dimensions and exact undo", async () => {
  const options = setup(), a = new RecommendationFeedCoordinator(options), b = new RecommendationFeedCoordinator({ ...options, key: "provider-b", provider: "b" });
  const later = command("snoozed"), read = command("read");
  const [snoozed, readReceipt] = await Promise.all([a.executeFeedback(later), b.executeFeedback(read)]);
  expect(readReceipt.committedRevision).not.toBe(snoozed.committedRevision);
  expect(await b.executeFeedback(later)).toEqual(snoozed);
  await a.executeFeedback(command("undo", snoozed.eventId));
  const reopened = new RecommendationFeedCoordinator({ ...options, key: "provider-c" });
  expect(isRecommendationHidden(item, await reopened.read())).toBe(true);
  expect((await reopened.read()).feedbackProjection?.map(row => row.action)).toEqual(["read"]);
  await reopened.executeFeedback(command("undo", readReceipt.eventId));
  expect(isRecommendationHidden(item, await reopened.read())).toBe(false);
});
test("facet identity survives renames, and difficulty undo preserves a later choice", async () => {
  const a = new RecommendationFeedCoordinator(setup());
  const old = await a.executeFeedback(command("too_basic"));
  await a.executeFeedback(command("too_advanced"));
  await a.executeFeedback(command("undo", old.eventId));
  await a.executeFeedback(command("not_relevant"));
  const state = await a.read();
  expect(state.feedbackProjection?.some(row => row.action === "too_advanced")).toBe(true);
  expect(isRecommendationHidden({ ...item, relatedDocumentTitle: "Renamed" }, state)).toBe(true);
  expect(isRecommendationHidden({ ...item, facetId: "facet-2" }, state)).toBe(false);
});
test("response loss retries the same command without duplicating a durable event", async () => {
  const options = setup(), a = new RecommendationFeedCoordinator(options), input = command("read");
  await a.read(); const commit = options.storage.commit; let loseResponse = true;
  options.storage.commit = async changes => { await commit(changes); if (loseResponse) { loseResponse = false; throw new Error("response lost"); } };
  await expect(a.executeFeedback(input)).rejects.toThrow("response lost");
  const receipt = await a.executeFeedback(input);
  expect(receipt.committedRevision).toBe(1); expect((await a.read()).feedbackProjection).toHaveLength(1);
});
test("compaction bounds undo history without dropping effective read state or accepting expired retries", () => {
  const state = emptyFeedback(), first = command("read"); first.issuedAt = 1;
  const original = commitFeedback(state, first, 1);
  for (let i = 2; i < 2100; i++) commitFeedback(state, { ...command(i % 2 ? "too_basic" : "too_advanced"), issuedAt: i }, i);
  expect(state.events).toHaveLength(512); expect(state.receipts).toHaveLength(2048);
  expect(projectFeedback(state, 2100).some(row => row.action === "read")).toBe(true);
  expect(() => commitFeedback(state, command("undo", original.eventId), 2101)).toThrow("可撤销范围");
  expect(() => commitFeedback(state, first, 2101)).toThrow("重试期限");
});
test("expired snooze never clears an independent read and migration is idempotent", async () => {
  const options = setup(); const key = "recommendation/v2/feed/provider-a";
  await options.storage.commit([{ key, expected: null, row: { key, version: "old", value: { epoch: 0, automaticRuns: [], saved: [], hidden: [item.canonicalId], feedback: [{ id: item.canonicalId, action: "snoozed", at: 1, facetId: "old title" }] } } }]);
  const a = new RecommendationFeedCoordinator(options); await a.read(); await a.executeFeedback(command("read"));
  expect(isRecommendationHidden(item, await a.read())).toBe(true);
  const before = await options.storage.list("recommendation/v2/feedback/"); await a.read();
  expect(await options.storage.list("recommendation/v2/feedback/")).toEqual(before);
});
for (const style of ["balanced", "frontier", "classic", "exploratory"] as const) test(`${style} consumes local difficulty for cached and scored candidates`, () => {
  const a = { ...item, preferencePenalty: .12 }, b = { ...item, id: "b", canonicalId: "doi:10.123/b", title: "Different topic", relevanceScore: .75 };
  expect(rankRecommendations([a, b], { style })[0].id).toBe("b");
  expect(rankRecommendations([a, b].map(row => ({ ...row, rankingStyle: style, scoreComponents: { finalScore: row.relevanceScore, baseRelevance: 0, diversityPenalty: 0, preference: 0, sourceRelevance: 0 } })), { style })[0].id).toBe("b");
});
