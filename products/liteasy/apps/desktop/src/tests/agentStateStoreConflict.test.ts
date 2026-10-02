import { beforeEach, expect, test, vi } from "vitest";
import { createScopedAgentStateStore, createTauriAgentStateStore } from "../app/controllers/agent/tauriAgentStateStore";
import { AGENT_STATE_SNAPSHOT_VERSION } from "../app/controllers/agent/agentStatePersistence";
const { rows, commit } = vi.hoisted(() => {
  const rows = new Map<string, { key: string; version: string; value: unknown }>();
  return { rows, commit: vi.fn(async (changes: Array<{ key: string; expected: string | null; row: { key: string; version: string; value: unknown } }>) => {
    for (const change of changes) if ((rows.get(change.key)?.version ?? null) !== change.expected) throw new Error("revision_conflict");
    for (const change of changes) rows.set(change.key, change.row);
  }) };
});
vi.mock("../app/features/objects/objectStorage", () => ({ createObjectStorage: () => ({ get: async (key: string) => rows.get(key) ?? null, commit }) }));
const snapshot = { version: AGENT_STATE_SNAPSHOT_VERSION, savedAt: "2026-10-02", sessions: [], pendingConfirmations: [] };
beforeEach(() => { rows.clear(); commit.mockClear(); localStorage.clear(); });
test("scoped state commits against the version it loaded, preserving concurrent edits", async () => {
  const first = createScopedAgentStateStore("local", () => "local");
  const second = createScopedAgentStateStore("local", () => "local");
  await first.load(); await second.load();
  await first.save(snapshot);
  await expect(second.save({ ...snapshot, savedAt: "stale" })).rejects.toThrow("revision_conflict");
  expect(rows.get("agent-state/public")?.value).toEqual(snapshot);
});
test("browser state preserves an external update since loading", async () => {
  const store = createTauriAgentStateStore();
  await store.load();
  localStorage.setItem("liteasy.agent-state.v1", "{\"future\":true}");
  await expect(Promise.resolve().then(() => store.save(snapshot))).rejects.toThrow("已被修改");
  expect(localStorage.getItem("liteasy.agent-state.v1")).toBe("{\"future\":true}");
});
