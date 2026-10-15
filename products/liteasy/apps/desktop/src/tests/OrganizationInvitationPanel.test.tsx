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
const summary = { ...organizationUiSummary, myRole: "owner" as const, revision: 7,
  members: [...organizationUiSummary.members,
    { id: "recipient-1", subject: "recipient-1", name: "林研究员", email: "lin@example.test", role: "member" as const, status: "active" as const, revision: 1 }] };
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
  await screen.findByText("林研究员 · lin@example.test");
  expect(screen.getByText("已接受")).toBeInTheDocument();
  expect(screen.getByText("已过期")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^撤回邀请/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "撤回邀请 林研究员 · lin@example.test" }));
  const dialog = screen.getByRole("alertdialog", { name: "确认撤回邀请" });
  expect(dialog).toHaveTextContent("林研究员 · lin@example.test");
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
  await screen.findByText("林研究员 · lin@example.test");
  expect(screen.queryByRole("button", { name: "撤回邀请 林研究员 · lin@example.test" })).not.toBeInTheDocument();
  rerender(<OrganizationInvitationPanel {...input} summary={{ ...summary, myRole: "member" }} />);
  expect(screen.queryByText("林研究员 · lin@example.test")).not.toBeInTheDocument();
  expect(transport).toHaveBeenCalledTimes(1);
});

test("account changes hide existing invitation data and discard old revoke receipts", async () => {
  let finish!: (result: Response) => void;
  const transport = vi.fn<OrganizationActionTransport>().mockResolvedValueOnce(response({ invitations: [invitation] })).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const input = props(transport);
  const { rerender } = render(<OrganizationInvitationPanel {...input} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await user.click(await screen.findByRole("button", { name: "撤回邀请 林研究员 · lin@example.test" }));
  await user.click(screen.getByRole("button", { name: "确认撤回" }));
  rerender(<OrganizationInvitationPanel {...input} session={{ ...session, userId: "another", sessionId: "another-token" }} />);
  expect(screen.queryByText("林研究员 · lin@example.test")).not.toBeInTheDocument();
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
  expect(screen.queryByText("林研究员 · lin@example.test")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await screen.findByText("邀请列表返回格式无效，请刷新组织权限后重试。");
  expect(screen.queryByText("WRONG_SCOPE_TARGET")).not.toBeInTheDocument();
});


test("the organization sidebar exposes the invitation manager and its real authenticated list request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ invitations: [invitation] }));
  try {
    render(<OrganizationSidebarPanel accountSession={session} cloudEndpoint="https://cloud.example" list={null} listMessage="" listStatus="success" onOpenWindow={vi.fn()} readNotificationIds={[]} summary={summary} summaryMessage="" summaryStatus="success" />);
    await userEvent.click(screen.getByRole("button", { name: "展开邀请管理" }));
    await screen.findByRole("article", { name: "邀请 林研究员 · lin@example.test" });
    expect(fetchMock).toHaveBeenCalledWith("https://cloud.example/v1/org/invitations/list", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer owner-token" }) }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ organizationId: summary.organizationId, sessionId: "owner-token" });
  } finally { fetchMock.mockRestore(); }
});


test("unresolved or ambiguous invitees cannot be revoked and raw subjects stay out of visible labels", async () => {
  const transport = vi.fn<OrganizationActionTransport>(async () => response({ invitations: [
    { ...invitation, targetSubject: "unresolved-target", createdBy: "unresolved-creator" },
    { ...invitation, invitationId: "invite-other", targetSubject: "alan" }
  ] }));
  render(<OrganizationInvitationPanel {...props(transport)} summary={{ ...summary, members: [
    { ...summary.members[1], name: "同名成员", email: undefined },
    { ...summary.members[2], name: "同名成员", email: undefined }
  ] }} />);
  await userEvent.click(screen.getByRole("button", { name: "展开邀请管理" }));
  expect(await screen.findByRole("button", { name: "撤回邀请 姓名尚未提供" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "撤回邀请 同名成员" })).toBeDisabled();
  expect(document.body.textContent).not.toContain("unresolved-target");
  expect(document.body.textContent).not.toContain("unresolved-creator");
  expect(screen.getAllByText("受邀者资料不足或无法区分，请刷新组织权限与邀请后再操作。")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "刷新组织权限" })).toBeEnabled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(transport).toHaveBeenCalledTimes(1);
});

test("same-name invitees use authorized email identities while revoke keeps its exact invitation", async () => {
  const second = { ...invitation, invitationId: "invite-alan", targetSubject: "alan" };
  const transport = vi.fn<OrganizationActionTransport>(async (request) => request.url.endsWith("/list")
    ? response({ invitations: [invitation, second] })
    : response({ invitation: { ...second, status: "revoked", revision: 1 }, organizationRevision: 8 }));
  render(<OrganizationInvitationPanel {...props(transport)} summary={{ ...summary, members: [
    { ...summary.members[1], name: "林研究员", email: "alan@example.test" }, summary.members[2]
  ] }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "展开邀请管理" }));
  await user.click(await screen.findByRole("button", { name: "撤回邀请 林研究员 · alan@example.test" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("林研究员 · alan@example.test");
  await user.click(screen.getByRole("button", { name: "确认撤回" }));
  await screen.findByText("已撤回");
  expect(JSON.parse(transport.mock.calls[1][0].body)).toMatchObject({ invitationId: "invite-alan", organizationId: summary.organizationId, expectedInvitationRevision: 0 });
});
