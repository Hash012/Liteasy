import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { OrganizationSidebarPanel } from "../app/features/organization/OrganizationSidebarPanel";
import { OrganizationInvitationPanel } from "../app/features/organization/OrganizationInvitationPanel";
import type { OrganizationActionTransport } from "../app/features/organization/organizationActionsClient";
import type { AccountSession } from "../app/features/account/account.types";
import { organizationUiSummary } from "./fixtures/organizationUiFixtures";

vi.mock("../app/features/organization/OrganizationStoragePolicyPanel", () => ({ OrganizationStoragePolicyPanel: () => null }));

const session: AccountSession = { endpoint: "https://cloud.example", issuer: "https://identity.example", userId: "owner", sessionId: "owner-token", name: "Synthetic owner", email: "owner@example.test", expiresAt: "2099-01-01T00:00:00Z" };
const summary = { ...organizationUiSummary, myRole: "owner" as const, revision: 7 };
const invitation = { invitationId: "invite-1", organizationId: summary.organizationId, role: "member" as const, status: "pending" as const, targetSubject: "recipient-1", createdBy: "owner", createdAt: "2026-10-03T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", revision: 0 };
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

function props(transport: OrganizationActionTransport) { return { session, summary, endpoint: "https://cloud.example", onChanged: vi.fn(), transport }; }

test("loads real invitation states on demand and revokes only after a target and revision confirmation", async () => {
  const transport = vi.fn<OrganizationActionTransport>(async (request) => request.url.endsWith("/list")
    ? response({ invitations: [invitation, { ...invitation, invitationId: "invite-used", targetSubject: "recipient-used", status: "accepted" }, { ...invitation, invitationId: "invite-expired", targetSubject: "recipient-expired", status: "expired" }] })
    : response({ invitation: { ...invitation, status: "revoked", revision: 1 }, organizationRevision: 8 }));
  const input = props(transport);
  render(<OrganizationInvitationPanel {...input} />);
  expect(transport).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await screen.findByText("recipient-1");
  expect(screen.getByText("已接受")).toBeInTheDocument();
  expect(screen.getByText("已过期")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^撤回邀请/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "撤回邀请 recipient-1" }));
  const dialog = screen.getByRole("alertdialog", { name: "确认撤回邀请" });
  expect(dialog).toHaveTextContent("recipient-1");
  expect(transport).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole("button", { name: "确认撤回" }));
  await screen.findByText("已撤回");
  const request = transport.mock.calls[1][0];
  expect(request.url).toBe("https://cloud.example/v1/org/invitations/revoke");
  expect(request.headers.Authorization).toBe("Bearer owner-token");
  expect(JSON.parse(request.body)).toMatchObject({ organizationId: summary.organizationId, invitationId: "invite-1", expectedRevision: 7, expectedInvitationRevision: 0 });
  expect(input.onChanged).toHaveBeenCalledTimes(1);
});

test("an admin cannot revoke an administrator invitation and members never load manager data", async () => {
  const transport = vi.fn<OrganizationActionTransport>(async () => response({ invitations: [{ ...invitation, role: "admin" }] }));
  const input = props(transport);
  const { rerender } = render(<OrganizationInvitationPanel {...input} summary={{ ...summary, myRole: "admin" }} />);
  await userEvent.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await screen.findByText("recipient-1");
  expect(screen.queryByRole("button", { name: "撤回邀请 recipient-1" })).not.toBeInTheDocument();
  rerender(<OrganizationInvitationPanel {...input} summary={{ ...summary, myRole: "member" }} />);
  expect(screen.queryByText("recipient-1")).not.toBeInTheDocument();
  expect(transport).toHaveBeenCalledTimes(1);
});

test("account changes hide existing invitation data and discard old revoke receipts", async () => {
  let finish!: (result: Response) => void;
  const transport = vi.fn<OrganizationActionTransport>().mockResolvedValueOnce(response({ invitations: [invitation] })).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const input = props(transport);
  const { rerender } = render(<OrganizationInvitationPanel {...input} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await user.click(await screen.findByRole("button", { name: "撤回邀请 recipient-1" }));
  await user.click(screen.getByRole("button", { name: "确认撤回" }));
  rerender(<OrganizationInvitationPanel {...input} session={{ ...session, userId: "another", sessionId: "another-token" }} />);
  expect(screen.queryByText("recipient-1")).not.toBeInTheDocument();
  await act(async () => { finish(response({ invitation: { ...invitation, status: "revoked", revision: 1 }, organizationRevision: 8 })); });
  expect(input.onChanged).not.toHaveBeenCalled();
  expect(screen.queryByText("已撤回")).not.toBeInTheDocument();
});

test("an endpoint change drops a late list and scope-mismatched responses are not displayed", async () => {
  let finish!: (result: Response) => void;
  const transport = vi.fn<OrganizationActionTransport>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(response({ invitations: [{ ...invitation, organizationId: "other-org", targetSubject: "WRONG_SCOPE_TARGET" }] }));
  const input = props(transport);
  const { rerender } = render(<OrganizationInvitationPanel {...input} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  rerender(<OrganizationInvitationPanel {...input} endpoint="https://different.example" session={{ ...session, endpoint: "https://different.example" }} />);
  await act(async () => { finish(response({ invitations: [invitation] })); });
  expect(screen.queryByText("recipient-1")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await screen.findByText("邀请列表返回格式无效，请刷新组织权限后重试。");
  expect(screen.queryByText("WRONG_SCOPE_TARGET")).not.toBeInTheDocument();
});


test("the organization sidebar exposes the invitation manager and its real authenticated list request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ invitations: [invitation] }));
  try {
    render(<OrganizationSidebarPanel accountSession={session} cloudEndpoint="https://cloud.example" list={null} listMessage="" listStatus="success" onOpenWindow={vi.fn()} readNotificationIds={[]} summary={summary} summaryMessage="" summaryStatus="success" />);
    await userEvent.click(screen.getByRole("button", { name: "展开邀请管理" }));
    await screen.findByText("recipient-1");
    expect(fetchMock).toHaveBeenCalledWith("https://cloud.example/v1/org/invitations/list", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer owner-token" }) }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ organizationId: summary.organizationId, sessionId: "owner-token" });
  } finally { fetchMock.mockRestore(); }
});
