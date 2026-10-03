import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CommunityOperationCenter } from "./CommunityOperationCenter";
import { commandRecords, draftOwner, saveCommand } from "./communityPersistence";
import { communityApi } from "./communityApi";
const session = { audience: "intuecho-web" as const, issuer: "https://id.test", userId: "a", name: "A", email: "a@test", sessionId: "token", expiresAt: "2099-01-01" };
vi.mock("./identityClient", () => ({ getIdentitySessionGeneration: () => 0, isIdentitySessionCurrent: async () => true, resolveIdentitySession: async () => session }));
vi.mock("./communityApi", () => ({ communityApi: { lookupCommand: vi.fn() } }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("reload shows unknown state without reading remotely or displaying stored organization bodies; only explicit lookup recovers", async () => {
  const owner = draftOwner(session);
  const operation = { operationId: "operation-1", operationType: "create_annotation" as const, bodyDigest: "a".repeat(64), targetId: null, state: "outcome_unknown" as const, updatedAt: "now", payload: { body: "ORG_BODY_MUST_NOT_RENDER" } };
  saveCommand(owner, operation);
  vi.mocked(communityApi.lookupCommand).mockResolvedValue({ status: "committed", available: false, receipt: { operationId: operation.operationId, operationType: operation.operationType, bodyDigest: operation.bodyDigest, resourceId: "annotation-1", committedAt: "now" } });
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
