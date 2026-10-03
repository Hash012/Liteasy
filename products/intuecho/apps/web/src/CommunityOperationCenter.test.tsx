import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CommunityOperationCenter } from "./CommunityOperationCenter";
import { commandRecords, draftOwner, saveCommand } from "./communityPersistence";
import { communityApi } from "./communityApi";
const session = { audience: "intuecho-web" as const, issuer: "https://id.test", userId: "a", name: "A", email: "a@test", sessionId: "token", expiresAt: "2099-01-01" };
vi.mock("./identityClient", () => ({ getIdentitySessionGeneration: () => 0, isIdentitySessionCurrent: async () => true, resolveIdentitySession: async () => session }));
vi.mock("./communityApi", () => ({ communityApi: { lookupCommand: vi.fn(), annotation: vi.fn(), replies: vi.fn() } }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("reload shows unknown state without reading remotely or displaying stored organization bodies; only explicit lookup recovers", async () => {
  const owner = draftOwner(session);
  const operation = { operationId: "operation-1", operationType: "create_annotation" as const, bodyDigest: "a".repeat(64), targetId: null, state: "outcome_unknown" as const, updatedAt: "now", payload: { body: "ORG_BODY_MUST_NOT_RENDER" } };
  saveCommand(owner, operation);
  vi.mocked(communityApi.lookupCommand).mockResolvedValue({ status: "committed", available: false, receipt: { operationId: operation.operationId, operationType: operation.operationType, bodyDigest: operation.bodyDigest, resourceId: "annotation-1", committedAt: "2026-10-03T00:00:00.000Z" } });
  const user = userEvent.setup();
  const view = render(<CommunityOperationCenter owner={owner} accountName="A" />);
  expect(communityApi.lookupCommand).not.toHaveBeenCalled();
  expect(screen.getByText(/结果待核实/)).toBeInTheDocument();
  expect(screen.queryByText("ORG_BODY_MUST_NOT_RENDER")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "核实原操作（只读）" }));
  await waitFor(() => expect(commandRecords(owner)[0].state).toBe("committed"));
  expect(screen.getByRole("status")).toHaveTextContent("当前来源不可访问");
  view.rerender(<CommunityOperationCenter owner={draftOwner({ ...session, userId: "b" })} accountName="B" />);
  expect(screen.queryByText(/operation-1/)).not.toBeInTheDocument();
  expect(screen.getByText("暂无社区发送记录。")).toBeInTheDocument();
});

test("opens a recovered result only after a fresh receipt and current source authorization", async () => {
  const owner = draftOwner(session);
  const operation = { operationId: "operation-open", operationType: "create_annotation" as const, bodyDigest: "a".repeat(64), targetId: null, state: "committed" as const, updatedAt: "now", resourceId: "annotation-1", payload: { body: "CACHED_BODY_NEVER_RENDER" } };
  saveCommand(owner, operation);
  const onOpenResult = vi.fn();
  vi.mocked(communityApi.lookupCommand).mockResolvedValue({ status: "committed", available: true, receipt: { operationId: operation.operationId, operationType: operation.operationType, bodyDigest: operation.bodyDigest, resourceId: "annotation-1", committedAt: "2026-10-03T00:00:00.000Z" } });
  vi.mocked(communityApi.annotation).mockResolvedValue({ annotation: { id: "annotation-1", withdrawnAt: null } } as never);
  render(<CommunityOperationCenter owner={owner} accountName="A" onOpenResult={onOpenResult} />);
  await userEvent.click(screen.getByRole("button", { name: "打开已创建内容" }));
  await waitFor(() => expect(onOpenResult).toHaveBeenCalledWith("annotation-1", undefined));
  expect(communityApi.lookupCommand).toHaveBeenCalledTimes(1);
  expect(communityApi.annotation).toHaveBeenCalledWith("annotation-1");
  expect(screen.queryByText("CACHED_BODY_NEVER_RENDER")).not.toBeInTheDocument();
});

test("an unavailable committed result keeps only generic status and never opens cached content", async () => {
  const owner = draftOwner(session);
  const operation = { operationId: "operation-revoked", operationType: "create_annotation" as const, bodyDigest: "b".repeat(64), targetId: null, state: "committed" as const, updatedAt: "now", resourceId: "restricted", payload: { body: "REVOKED_BODY" } };
  saveCommand(owner, operation);
  vi.mocked(communityApi.lookupCommand).mockResolvedValue({ status: "committed", available: false, receipt: { operationId: operation.operationId, operationType: operation.operationType, bodyDigest: operation.bodyDigest, resourceId: "restricted", committedAt: "2026-10-03T00:00:00.000Z" } });
  const onOpenResult = vi.fn();
  render(<CommunityOperationCenter owner={owner} accountName="A" onOpenResult={onOpenResult} />);
  await userEvent.click(screen.getByRole("button", { name: "打开已创建内容" }));
  expect(await screen.findByRole("status")).toHaveTextContent("当前内容不可访问");
  expect(onOpenResult).not.toHaveBeenCalled();
  expect(communityApi.annotation).not.toHaveBeenCalled();
  expect(screen.queryByText("REVOKED_BODY")).not.toBeInTheDocument();
});

test("restores the exact original intent only after confirmation without sending or exposing its body in the center", async () => {
  const owner = draftOwner(session);
  const operation = { operationId: "operation-draft", operationType: "create_annotation" as const, bodyDigest: "c".repeat(64), targetId: null, state: "outcome_unknown" as const, updatedAt: "now", payload: { body: "MY_FROZEN_ORIGINAL_DRAFT" } };
  saveCommand(owner, operation);
  const onRestoreOperation = vi.fn();
  render(<CommunityOperationCenter owner={owner} accountName="A" onRestoreOperation={onRestoreOperation} />);
  await userEvent.click(screen.getByRole("button", { name: "打开原稿" }));
  expect(onRestoreOperation).not.toHaveBeenCalled();
  expect(screen.queryByText("MY_FROZEN_ORIGINAL_DRAFT")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "确认恢复原稿" }));
  await waitFor(() => expect(onRestoreOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: operation.operationId, payload: operation.payload })));
  expect(communityApi.lookupCommand).not.toHaveBeenCalled();
});
