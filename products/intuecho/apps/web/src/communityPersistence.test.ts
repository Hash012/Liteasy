import { beforeEach, expect, test, vi } from "vitest";
import { draftOwner, loadDraft, saveDraft, commandRecords, saveCommand, quarantinedRecords, readCommand, saveDraftRevision, draftRecords, removeDraftRevision, archiveCompletedCommands, exportCommunityRecords } from "./communityPersistence";

const session = { audience: "intuecho-web" as const, issuer: "https://id.example.test", userId: "actor-a", name: "A", email: "a@example.test", sessionId: "token-a", expiresAt: "2099-01-01" };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

test("durable draft ownership binds environment, issuer, subject and scope, not session token", () => {
  const owner = draftOwner(session, "https://community.example.test");
  saveDraft(owner, "edit:1", { body: "PRIVATE_DRAFT", expectedRevision: 4 });
  expect(loadDraft(draftOwner({ ...session, sessionId: "new-token" }, "https://community.example.test"), "edit:1")?.value).toEqual({ body: "PRIVATE_DRAFT", expectedRevision: 4 });
  expect(loadDraft(draftOwner({ ...session, userId: "actor-b" }, "https://community.example.test"), "edit:1")).toBeNull();
  expect(loadDraft(draftOwner({ ...session, issuer: "https://other.test" }, "https://community.example.test"), "edit:1")).toBeNull();
  expect(loadDraft(draftOwner(session, "https://other-community.test"), "edit:1")).toBeNull();
  expect(loadDraft(owner, "reply:1")).toBeNull();
});

test("storage quota failure cannot be acknowledged as a saved draft or pending operation", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
  expect(() => saveDraft("actor", "new", { body: "not saved" })).toThrow("草稿尚未保存");
  expect(() => saveCommand("actor", { operationId: "op", operationType: "create_annotation", bodyDigest: "a".repeat(64), targetId: null, state: "outcome_unknown", updatedAt: "now" })).toThrow("操作记录未能保存");
  expect(commandRecords("actor")).toEqual([]);
});

test("corrupt command storage is isolated while the exact original intent fails closed", () => {
  saveCommand("actor", { operationId: "op", operationType: "create_annotation", bodyDigest: "a".repeat(64), targetId: null, state: "outcome_unknown", updatedAt: "now" });
  const storageKey = localStorage.key(0)!;
  localStorage.setItem(storageKey, "broken-json");
  expect(commandRecords("actor")).toEqual([]);
  expect(quarantinedRecords("actor")[0].raw).toBe("broken-json");
  expect(() => readCommand("actor", "create_annotation", "op")).toThrow("不可重放");
});

test("two tabs editing one draft retain a conflict branch and cleanup requires the exact persisted revision", async () => {
  const first = await saveDraftRevision("actor", "new", { body: "v1" }, { draftId: "draft-a", expectedRevision: 0, writerId: "tab-a" });
  const second = await saveDraftRevision("actor", "new", { body: "v2 from tab B" }, { draftId: "draft-a", expectedRevision: 1, writerId: "tab-b" });
  const branch = await saveDraftRevision("actor", "new", { body: "v2 from tab A" }, { draftId: "draft-a", expectedRevision: 1, writerId: "tab-a" });
  expect(branch).toMatchObject({ conflictOf: "draft-a", localRevision: 1 });
  expect(branch.draftId).not.toBe(first.draftId);
  expect(await removeDraftRevision("actor", "new", first)).toBe(false);
  expect(draftRecords("actor", "new").map((draft) => draft.value)).toEqual(expect.arrayContaining([second.value, branch.value]));
});

test("legacy drafts remain recoverable and editing migrates into an independent record", async () => {
  const legacyKey = `intuecho.community.local.v1:${encodeURIComponent("actor")}:draft:new`;
  const raw = JSON.stringify({ version: 1, owner: "actor", scope: "new", updatedAt: "2026-10-03", value: { body: "legacy" } });
  localStorage.setItem(legacyKey, raw);
  const legacy = loadDraft("actor", "new")!;
  const next = await saveDraftRevision("actor", "new", { body: "edited" }, { draftId: legacy.draftId, expectedRevision: legacy.localRevision, writerId: "tab" });
  expect(next.draftId).not.toBe(legacy.draftId); expect(localStorage.getItem(legacyKey)).toBe(raw);
  expect(loadDraft("actor", "new", next.draftId)?.value).toEqual({ body: "edited" });
});

test("a corrupt known draft is preserved rather than overwritten during an attempted save", () => {
  const original = saveDraft("actor", "scope", { body: "original" });
  const storageKey = localStorage.key(0)!; localStorage.setItem(storageKey, "{broken");
  const rescued = saveDraft("actor", "scope", { body: "new" }, { draftId: original.draftId, expectedRevision: 0, writerId: "tab" });
  expect(rescued.conflictOf).toBe(original.draftId); expect(localStorage.getItem(storageKey)).toBe("{broken");
  expect(quarantinedRecords("actor")).toHaveLength(1);
});

test("completed archival bounds full receipts while retaining original intent identity and all unknown payloads", () => {
  const base = { operationType: "create_reply" as const, bodyDigest: "a".repeat(64), targetId: "parent", updatedAt: "2026-10-03T00:00:00Z" };
  saveCommand("actor", { ...base, operationId: "unknown", state: "outcome_unknown", payload: { body: "must survive" } });
  for (let index = 0; index < 4; index++) saveCommand("actor", { ...base, operationId: `done-${index}`, state: "committed", resourceId: `reply-${index}` });
  archiveCompletedCommands("actor", 1);
  expect(commandRecords("actor")).toHaveLength(2);
  expect(readCommand("actor", "create_reply", "done-3")).toMatchObject({ state: "committed", targetId: "parent", resourceId: "reply-3" });
  expect(readCommand("actor", "create_reply", "unknown")?.payload).toEqual({ body: "must survive" });
  expect(JSON.parse(exportCommunityRecords("actor")).records).toHaveLength(5);
});
