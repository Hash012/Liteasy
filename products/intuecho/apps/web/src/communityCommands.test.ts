import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { communityApi } from "./communityApi";
import { CommunityOutcomeUnknownError, recoverCommand } from "./communityCommands";
import { commandRecords, draftOwner } from "./communityPersistence";
import { isIdentitySessionCurrent, resolveIdentitySession } from "./identityClient";

vi.mock("./identityClient", () => ({
  clearRejectedIdentitySession: vi.fn(), notifyAuthenticationRequired: vi.fn(), getIdentitySessionGeneration: vi.fn(() => 0),
  isIdentitySessionCurrent: vi.fn(async () => true), resolveIdentitySession: vi.fn()
}));
const session = { audience: "intuecho-web" as const, issuer: "https://identity.test", userId: "actor-a", email: "a@example.test", name: "A", sessionId: "token-a", expiresAt: "2099-01-01" };
const input = { body: "SYNTHETIC_PRIVATE_BODY", visibility: "private" as const, shareToPlaza: false, tags: [], targets: [{ kind: "whole_document" as const, literature: { literatureId: "confirmed-1" } }] };
const owner = draftOwner(session);
let intentId: string;
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
beforeEach(() => { intentId = crypto.randomUUID(); localStorage.clear(); vi.mocked(resolveIdentitySession).mockResolvedValue(session); vi.mocked(isIdentitySessionCurrent).mockResolvedValue(true); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("persists a frozen operation before fetch and transport loss never mints another ID or resends", async () => {
  const send = vi.fn<typeof fetch>(async () => {
    const records = commandRecords(owner);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ state: "outcome_unknown", payload: input });
    throw new TypeError("response lost after commit");
  });
  vi.stubGlobal("fetch", send);
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toBeInstanceOf(CommunityOutcomeUnknownError);
  const original = commandRecords(owner)[0];
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toBeInstanceOf(CommunityOutcomeUnknownError);
  await expect(communityApi.createAnnotation({ ...input, body: "Edited while unknown" }, intentId)).rejects.toBeInstanceOf(CommunityOutcomeUnknownError);
  expect(send).toHaveBeenCalledTimes(1);
  expect(commandRecords(owner).map((record) => record.operationId)).toEqual([original.operationId]);
  const sent = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
  expect(sent.command).toEqual({ protocolVersion: 1, operationId: original.operationId, bodyDigest: original.bodyDigest });
});

test("explicit read-only recovery can confirm a commit without exposing or resending old body", async () => {
  const send = vi.fn().mockRejectedValueOnce(new TypeError("lost")); vi.stubGlobal("fetch", send);
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  const original = commandRecords(owner)[0];
  send.mockResolvedValueOnce(ok({ status: "committed", available: false, receipt: { operationId: original.operationId, operationType: original.operationType, bodyDigest: original.bodyDigest, resourceId: "annotation-1", committedAt: "2026-10-03T00:00:00.000Z" } }));
  const result = await recoverCommand(owner, original, communityApi.lookupCommand);
  expect(result).toMatchObject({ status: "committed", available: false });
  expect(send.mock.calls[1][0]).toContain(`/community-commands/create_annotation/${original.operationId}`);
  expect(send.mock.calls[1][1].method).toBeUndefined();
  expect(commandRecords(owner)[0]).toMatchObject({ operationId: original.operationId, state: "committed" });
  expect(commandRecords(owner)[0].payload).toBeUndefined();
});

test("not-found lookup permits only an explicit send with the original stable operation ID", async () => {
  const send = vi.fn().mockRejectedValueOnce(new TypeError("lost")); vi.stubGlobal("fetch", send);
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  const original = commandRecords(owner)[0];
  send.mockResolvedValueOnce(ok({ status: "not_found" }));
  await recoverCommand(owner, original, communityApi.lookupCommand);
  expect(send).toHaveBeenCalledTimes(2);
  await expect(communityApi.createAnnotation({ ...input, body: "Changed after lookup" }, intentId)).rejects.toThrow("保持已冻结内容");
  expect(send).toHaveBeenCalledTimes(2);
  expect(commandRecords(owner)).toHaveLength(1);
  send.mockResolvedValueOnce(ok({ annotation: { id: "annotation-1" } }));
  await communityApi.createAnnotation(input, intentId);
  expect(JSON.parse(send.mock.calls[2][1].body).command.operationId).toBe(original.operationId);
  expect(commandRecords(owner)).toHaveLength(1);
});

test("storage failure and another actor's recovery are rejected before network writes", async () => {
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("操作记录未能保存");
  expect(send).not.toHaveBeenCalled();
  await expect(recoverCommand("another-actor", { operationId: "old", operationType: "create_annotation", bodyDigest: "a".repeat(64), targetId: null, state: "outcome_unknown", updatedAt: "now" }, communityApi.lookupCommand)).rejects.toThrow("账号会话已变化");
  expect(send).not.toHaveBeenCalled();
});

test("content updates send caller revisions and retain structured conflict status", async () => {
  const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "ANNOTATION_REVISION_CONFLICT", currentRevision: 5 }), { status: 409 }));
  vi.stubGlobal("fetch", send);
  await expect(communityApi.updateAnnotation("annotation-1", { body: "v4 draft", expectedRevision: 4 })).rejects.toMatchObject({ status: 409, code: "ANNOTATION_REVISION_CONFLICT" });
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ body: "v4 draft", expectedRevision: 4 });
});

test("restoring a committed draft keeps its original operation and cannot silently publish a duplicate", async () => {
  const intentId = crypto.randomUUID();
  const send = vi.fn().mockRejectedValueOnce(new TypeError("lost")); vi.stubGlobal("fetch", send);
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  const original = commandRecords(owner)[0];
  send.mockResolvedValueOnce(ok({ status: "committed", available: true, receipt: { operationId: intentId, operationType: "create_annotation", bodyDigest: original.bodyDigest, resourceId: "annotation-1", committedAt: "2026-10-03T00:00:00.000Z" } }));
  await recoverCommand(owner, original, communityApi.lookupCommand);
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("原操作已提交");
  expect(send).toHaveBeenCalledTimes(2);
  send.mockResolvedValueOnce(ok({ annotation: { id: "annotation-2" } }));
  await communityApi.createAnnotation(input, crypto.randomUUID());
  expect(send).toHaveBeenCalledTimes(3);
  expect(commandRecords(owner)).toHaveLength(2);
});

test("a second client instance cannot send a new command for an in-flight draft", async () => {
  const intentId = crypto.randomUUID();
  let finish!: (response: Response) => void;
  const send = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", send);
  const first = communityApi.createAnnotation(input, intentId);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  vi.resetModules();
  const otherClient = (await import("./communityApi")).communityApi;
  await expect(otherClient.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  expect(send).toHaveBeenCalledTimes(1);
  finish(ok({ annotation: { id: "annotation-1" } }));
  await first;
  await expect(otherClient.createAnnotation(input, intentId)).rejects.toThrow("原操作已提交");
  expect(commandRecords(owner).map((record) => record.operationId)).toEqual([intentId]);
});

test.each(["COMMAND_RESULT_UNAVAILABLE", "COMMAND_PAYLOAD_CONFLICT"])("%s preserves the original unresolved operation instead of claiming no commit", async (code) => {
  const intentId = crypto.randomUUID();
  const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: code }), { status: 409 }));
  vi.stubGlobal("fetch", send);
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  const [operation] = commandRecords(owner);
  expect(operation).toMatchObject({ operationId: intentId, state: "outcome_unknown", payload: input });
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  expect(send).toHaveBeenCalledTimes(1);
  send.mockResolvedValueOnce(ok({ status: "committed", available: false, receipt: { operationId: intentId, operationType: "create_annotation", bodyDigest: operation.bodyDigest, resourceId: "old-annotation", committedAt: "2026-10-03T00:00:00.000Z" } }));
  await recoverCommand(owner, operation, communityApi.lookupCommand);
  expect(commandRecords(owner)[0]).toMatchObject({ state: "committed", resourceId: "old-annotation" });
  expect(commandRecords(owner)[0].payload).toBeUndefined();
});

test("a missing explicit intent ID cannot send or mint a replacement", async () => {
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  await expect(communityApi.createAnnotation(input, undefined as never)).rejects.toThrow("操作 ID");
  expect(send).not.toHaveBeenCalled(); expect(commandRecords(owner)).toHaveLength(0);
});

test("different payloads cannot coalesce behind the same in-flight intent", async () => {
  let finish!: (response: Response) => void;
  const send = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", send);
  const first = communityApi.createAnnotation(input, intentId);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  await expect(communityApi.createAnnotation({ ...input, body: "changed" }, intentId)).rejects.toThrow("保持已冻结内容");
  finish(ok({ annotation: { id: "one" } })); await first;
  expect(send).toHaveBeenCalledOnce();
});

test("a valid late direct commit supersedes an earlier not_found without creating another operation", async () => {
  let finish!: (response: Response) => void;
  const send = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", send);
  const first = communityApi.createAnnotation(input, intentId);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  const original = commandRecords(owner)[0];
  await recoverCommand(owner, original, async () => ({ status: "not_found" }));
  expect(commandRecords(owner)[0].state).toBe("prepared");
  finish(ok({ annotation: { id: "committed-late" } })); await first;
  expect(commandRecords(owner)[0]).toMatchObject({ state: "committed", resourceId: "committed-late", operationId: intentId });
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("原操作已提交");
  expect(send).toHaveBeenCalledOnce();
});

test.each([
  { status: "not_found", receipt: {} },
  { status: "committed", available: "yes", receipt: { resourceId: "resource", committedAt: "2026-10-03T00:00:00Z" } },
  { status: "committed", receipt: { resourceId: "", committedAt: "2026-10-03T00:00:00Z" } },
  { status: "committed", receipt: { resourceId: "resource", committedAt: "not-a-date" } },
  { status: "committed", receipt: { resourceId: "resource", committedAt: "2026-10-03T00:00:00Z", operationId: "mismatched" } }
])("untrusted lookup %j cannot unlock a frozen operation", async (invalid) => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("lost")));
  await expect(communityApi.createAnnotation(input, intentId)).rejects.toThrow("待核实");
  const original = commandRecords(owner)[0];
  const response = invalid.status === "committed" ? { ...invalid, receipt: {
    operationId: intentId, operationType: original.operationType, bodyDigest: original.bodyDigest, ...invalid.receipt
  } } : invalid;
  await expect(recoverCommand(owner, original, async () => response as never)).rejects.toThrow("回执不一致");
  expect(commandRecords(owner)[0]).toEqual(original);
});
