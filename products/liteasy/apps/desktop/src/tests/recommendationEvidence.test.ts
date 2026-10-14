import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "vitest";
import { loadRecommendationPreferences, saveRecommendationPreferences, parseRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import { createRecommendationEvidenceStore, QualifiedReadingClock } from "../app/features/recommendations/recommendationEvidence";
beforeEach(() => localStorage.clear());
test("migration retains legacy consent without enabling new collection", () => {
  const prefs = parseRecommendationPreferences(JSON.stringify({ version: 1, hybridEnabled: true, useAnnotations: false, useProfile: true, sendPrivateText: true, embedding: { endpoint: "https://a.test", model: "x" }, reranker: { endpoint: "", model: "" } }));
  expect(prefs.version).toBe(2); expect(prefs.useAnnotations).toBe(false); expect(prefs.sendPrivateText).toBe(true);
  expect(prefs.signals.readingActivity).toBe(false); expect(prefs.signals.userQuestions).toBe(false); expect(prefs.generationEnabled).toBe(false);
});
test("consent gates committed evidence; retries deduplicate, edits replace, forget fences stale events", async () => {
  const scope = crypto.randomUUID(), store = createRecommendationEvidenceStore(scope, () => scope);
  const event = { id: "m1", type: "user_question_committed", sourceId: "chat:c", producerActionId: "send:1", revision: "1", at: Date.now(), text: "vector indexes", epoch: 0 };
  await store.record(event); expect((await store.read()).events).toEqual([]);
  saveRecommendationPreferences({ ...loadRecommendationPreferences(), signals: { ...loadRecommendationPreferences().signals, userQuestions: true } });
  const epoch = loadRecommendationPreferences().consentEpoch;
  await store.record({ ...event, epoch }); await store.record({ ...event, epoch });
  expect((await store.read()).events).toHaveLength(1);
  await store.forget([event.sourceId]); await store.record({ ...event, epoch, id: "late" });
  expect((await store.read()).events).toEqual([]);
});
test("qualified reader excludes unfocused, idle, sleep and preview time", () => {
  const clock = new QualifiedReadingClock(); clock.interact(0);
  expect(clock.tick(1000, true)).toBe(1000);
  expect(clock.tick(2000, false)).toBe(0);
  expect(clock.tick(100000, true)).toBe(0);
  clock.interact(100000); expect(clock.tick(101000, true)).toBe(1000);
});
