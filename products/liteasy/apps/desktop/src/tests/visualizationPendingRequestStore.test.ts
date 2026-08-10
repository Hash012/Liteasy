import { beforeEach, expect, test } from "vitest";
import { createVisualizationPendingRequestStore } from "../app/features/visualization/visualizationPendingRequestStore";

const pending = {
  artifactId: "artifact-1",
  createdAt: "2026-08-10T00:00:00.000Z",
  nodeId: "node-1",
  requestId: "request-1",
  requestedArtifactCount: 1 as const
};

beforeEach(() => window.localStorage.clear());

test("isolates exact pending coordinates by normalized endpoint and subject", () => {
  const first = createVisualizationPendingRequestStore({
    endpoint: "https://api.example/",
    now: () => new Date("2026-08-10T01:00:00.000Z"),
    storage: window.localStorage,
    subjectId: "user-1"
  });
  first.put(pending);
  expect(first.list()).toEqual([pending]);
  expect(createVisualizationPendingRequestStore({
    endpoint: "https://api.example",
    now: () => new Date("2026-08-10T01:00:00.000Z"),
    storage: window.localStorage,
    subjectId: "user-1"
  }).list()).toEqual([pending]);
  expect(createVisualizationPendingRequestStore({
    endpoint: "https://api.example",
    storage: window.localStorage,
    subjectId: "user-2"
  }).list()).toEqual([]);
});

test("rejects request-id coordinate reuse and removes terminal requests", () => {
  const store = createVisualizationPendingRequestStore({
    endpoint: "https://api.example",
    now: () => new Date("2026-08-10T01:00:00.000Z"),
    storage: window.localStorage,
    subjectId: "user-1"
  });
  store.put(pending);
  store.put(pending);
  expect(() => store.put({ ...pending, nodeId: "node-2" })).toThrow("visualization_pending_request_id_reused");
  store.remove("request-1");
  expect(store.list()).toEqual([]);
});

test("drops malformed and older-than-24-hour entries", () => {
  const store = createVisualizationPendingRequestStore({
    endpoint: "https://api.example",
    now: () => new Date("2026-08-11T00:00:00.001Z"),
    storage: window.localStorage,
    subjectId: "user-1"
  });
  store.put(pending);
  const key = window.localStorage.key(0)!;
  window.localStorage.setItem(key, JSON.stringify([pending, { requestId: "poisoned", subjectId: "user-2" }]));
  expect(store.list()).toEqual([]);
  expect(window.localStorage.getItem(key)).toBeNull();
});
