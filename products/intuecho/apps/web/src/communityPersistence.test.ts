import { beforeEach, expect, test, vi } from "vitest";
import { draftOwner, loadDraft, saveDraft, commandRecords, saveCommand } from "./communityPersistence";

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

test("corrupt command storage fails closed instead of allowing an untracked replacement", () => {
  saveCommand("actor", { operationId: "op", operationType: "create_annotation", bodyDigest: "a".repeat(64), targetId: null, state: "outcome_unknown", updatedAt: "now" });
  const storageKey = localStorage.key(0)!;
  localStorage.setItem(storageKey, "broken-json");
  expect(() => commandRecords("actor")).toThrow("操作记录损坏");
});
