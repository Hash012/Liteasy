import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { durableCreate, recoverCommand } from "./communityCommands";
import { commandRecords, draftOwner, loadDraft, removeDraft, saveCommand, saveDraft, type CommandRecord } from "./communityPersistence";
import { resolveIdentitySession } from "./identityClient";
vi.mock("./identityClient", () => ({ getIdentitySessionGeneration: () => 0, isIdentitySessionCurrent: async () => true, resolveIdentitySession: vi.fn() }));
const session = { audience: "intuecho-web" as const, issuer: "https://id.test", userId: "actor", name: "A", email: "a@test", sessionId: "test", expiresAt: "2099-01-01" };
const owner = draftOwner(session);
const input = { body: "synthetic", visibility: "organization", organizationId: "A", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: "confirmed-1" } }] };
const record = (id: string): CommandRecord => ({ operationId: id, operationType: "create_annotation", targetId: null, bodyDigest: "a".repeat(64), state: "outcome_unknown", updatedAt: "2026-10-03T00:00:00Z", payload: { body: "synthetic" } });
beforeEach(() => { localStorage.clear(); vi.mocked(resolveIdentitySession).mockResolvedValue(session); });
afterEach(() => vi.restoreAllMocks());
test("P01: an unknown create in organization A does not block an independent intent in B", async () => {
  await expect(durableCreate("create_annotation", null, { ...input, body: "A", organizationId: "A" }, async () => { throw Error("response loss"); }, "11111111-1111-4111-8111-111111111111")).rejects.toThrow("待核实");
  const send = vi.fn(async () => ({ annotation: { id: "b" } }));
  await expect(durableCreate("create_annotation", null, { ...input, body: "B", organizationId: "B" }, send, "22222222-2222-4222-8222-222222222222")).resolves.toEqual({ annotation: { id: "b" } });
  expect(send).toHaveBeenCalledTimes(1); expect(commandRecords(owner)).toHaveLength(2);
});
test("P02: corrupt commands remain byte-for-byte recoverable while healthy records and unrelated work continue", async () => {
  saveCommand(owner, { ...record("healthy"), state: "committed", resourceId: "result" });
  const brokenKey = `intuecho.community.local.v1:${encodeURIComponent(owner)}:command:broken`;
  localStorage.setItem(brokenKey, "{broken");
  expect(commandRecords(owner)).toHaveLength(1);
  await expect(durableCreate("create_annotation", null, { ...input, body: "new" }, async () => ({ annotation: { id: "new" } }), "33333333-3333-4333-8333-333333333333")).resolves.toBeDefined();
  expect(localStorage.getItem(brokenKey)).toBe("{broken");
});
test("P03: independent draft identities prevent overwrite and stale cleanup", () => {
  const a = saveDraft(owner, "new-annotation", { intentId: "A", body: "A" });
  const b = saveDraft(owner, "new-annotation", { intentId: "B", body: "B" });
  expect(loadDraft(owner, "new-annotation", a.draftId)?.value).toEqual(a.value);
  expect(loadDraft(owner, "new-annotation", b.draftId)?.value).toEqual(b.value);
  removeDraft(owner, "new-annotation", a);
  expect(loadDraft(owner, "new-annotation")?.value).toEqual(b.value);
});
test("P04: late not_found lookup cannot regress a committed command", async () => {
  const original = record("late"); saveCommand(owner, original);
  let finish!: (value: { status: "not_found" }) => void;
  const lookup = vi.fn(() => new Promise<{ status: "not_found" }>((resolve) => { finish = resolve; }));
  const recovery = recoverCommand(owner, original, lookup);
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  saveCommand(owner, { ...original, state: "committed", resourceId: "done" });
  finish({ status: "not_found" }); await expect(recovery).rejects.toThrow("已提交");
  expect(commandRecords(owner)[0]).toMatchObject({ state: "committed", resourceId: "done" });
});
test.each([{}, { status: "surprise" }, { status: "committed" }, { status: "committed", receipt: {} }])("P05: invalid lookup %j never permits retry", async (result) => {
  const original = record("invalid"); saveCommand(owner, original);
  await expect(recoverCommand(owner, original, async () => result as never)).rejects.toThrow();
  expect(commandRecords(owner)[0].state).toBe("outcome_unknown");
});
