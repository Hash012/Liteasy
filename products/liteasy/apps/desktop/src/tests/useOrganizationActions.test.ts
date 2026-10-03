import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AccountSession } from "../app/features/account/account.types";
import type { OrganizationActionTransport } from "../app/features/organization/organizationActionsClient";
import { useOrganizationActions } from "../app/features/organization/useOrganizationActions";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

const accountSession: AccountSession = {
  endpoint: "https://cloud.example",
  issuer: "https://identity.example",
  email: "reader@example.com",
  expiresAt: "2026-08-20T00:00:00Z",
  membershipTier: "pro",
  name: "Reader",
  sessionId: "session-token",
  userId: "reader-id"
};

const organizationSummary: OrganizationSummary = {
  auditEvents: [],
  canCreateOrganization: false,
  memberCount: 12,
  members: [],
  myMemberRevision: 3,
  myRole: "member",
  name: "Liteasy AI Reading Lab",
  notifications: [],
  ownerUserId: "owner-1",
  organizationId: "org-1",
  quota: {
    configured: true,
    periodEndsAt: "2026-09-01T00:00:00Z",
    storageLimitGb: 100,
    storageUsedGb: 38
  },
  revision: 7,
  sharedLibrary: {
    documentCount: 48,
    documents: [],
    name: "组织共享文献库",
    status: "available"
  },
  taskSummary: { failed: 1, running: 2 }
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

function actionTransport() {
  return vi.fn<OrganizationActionTransport>(async (request) => {
    if (request.url.endsWith("/create")) {
      return jsonResponse({ organization: {
        myRole: "owner", name: "Research Lab", organizationId: "org-created", revision: 0
      } });
    }
    if (request.url.endsWith("/join")) {
      return jsonResponse({
        membership: { revision: 0, role: "member", status: "active", subject: "reader-id" },
        organizationId: "org-1",
        organizationRevision: 2
      });
    }
    if (request.url.endsWith("/invite")) {
      return jsonResponse({
        invitation: {
          invitationToken: `orginv_${"a".repeat(43)}`,
          organizationId: "org-1",
          role: "admin",
          targetSubject: "user:invitee"
        },
        organizationRevision: 8
      });
    }
    return jsonResponse({ left: true, organizationId: "org-1" });
  });
}

function renderActions(input: {
  canCreateOrganization?: boolean;
  onOrganizationChanged?: (organizationId?: string) => void;
  session?: AccountSession | null;
  transport?: OrganizationActionTransport;
} = {}) {
  const onAnalysisHint = vi.fn();
  const result = renderHook(() => useOrganizationActions({
    accountSession: input.session === undefined ? accountSession : input.session,
    canCreateOrganization: input.canCreateOrganization ?? true,
    controlPlaneEndpoint: "https://cloud.example",
    onAnalysisHint,
    onOrganizationChanged: input.onOrganizationChanged,
    transport: input.transport ?? actionTransport()
  }));
  return { ...result, onAnalysisHint };
}

describe("useOrganizationActions", () => {
  test("executes create, join, invite, and leave through authenticated organization APIs", async () => {
    const transport = actionTransport();
    const onOrganizationChanged = vi.fn();
    const { result } = renderActions({ onOrganizationChanged, transport });

    act(() => result.current.openCreateDialog());
    await act(() => result.current.createOrganizationRequest("Research Lab"));
    expect(result.current.createOpen).toBe(false);
    expect(result.current.actionMessage).toBe("已创建组织“Research Lab”。");

    act(() => result.current.openJoinDialog());
    await act(() => result.current.joinOrganizationRequest(`orginv_${"b".repeat(43)}`));
    expect(result.current.joinOpen).toBe(false);

    act(() => result.current.openInviteDialog({ ...organizationSummary, myRole: "owner" }));
    await act(() => result.current.inviteOrganizationMember({ role: "admin", targetSubject: "user:invitee" }));
    expect(result.current.inviteSummary).toBeNull();
    expect(result.current.actionMessage).toContain(`orginv_${"a".repeat(43)}`);

    act(() => result.current.openLeaveDialog({ ...organizationSummary, myRole: "admin" }));
    await act(() => result.current.leaveOrganizationRequest());
    expect(result.current.leaveSummary).toBeNull();

    expect(transport).toHaveBeenCalledTimes(4);
    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual(expect.objectContaining({
      displayName: "Reader",
      name: "Research Lab",
      sessionId: "session-token"
    }));
    expect(JSON.parse(transport.mock.calls[0][0].body).idempotencyKey).toMatch(/^organization:create:/);
    expect(JSON.parse(transport.mock.calls[1][0].body)).toEqual(expect.objectContaining({
      expectedInvitationRevision: 0,
      invitationToken: `orginv_${"b".repeat(43)}`,
      sessionId: "session-token"
    }));
    expect(JSON.parse(transport.mock.calls[2][0].body)).toEqual(expect.objectContaining({
      displayName: "Reader",
      expectedRevision: 7,
      organizationId: "org-1",
      role: "admin",
      sessionId: "session-token",
      targetSubject: "user:invitee"
    }));
    expect(JSON.parse(transport.mock.calls[3][0].body)).toEqual(expect.objectContaining({
      expectedMemberRevision: 3,
      expectedRevision: 7,
      organizationId: "org-1"
    }));
    for (const call of transport.mock.calls) {
      expect(call[0].headers.Authorization).toBe("Bearer session-token");
    }
    expect(onOrganizationChanged).toHaveBeenNthCalledWith(1, "org-created");
    expect(onOrganizationChanged).toHaveBeenNthCalledWith(2, "org-1");
    expect(onOrganizationChanged).toHaveBeenNthCalledWith(3, "org-1");
    expect(onOrganizationChanged).toHaveBeenNthCalledWith(4);
  });

  test("keeps the dialog open and exposes stable server errors", async () => {
    const transport = vi.fn<OrganizationActionTransport>(async () => jsonResponse({
      code: "organization_invitation_required",
      message: "organization_invitation_required",
      traceId: "trace-1"
    }, 403));
    const { result } = renderActions({ transport });

    act(() => result.current.openJoinDialog());
    await act(() => result.current.joinOrganizationRequest(`orginv_${"c".repeat(43)}`));

    expect(result.current.joinOpen).toBe(true);
    expect(result.current.actionMessage).toBe("没有找到面向当前账号的有效邀请。");
    expect(result.current.actionPending).toBe(false);
  });

  test("blocks owner leave and member invites before any request is sent", async () => {
    const transport = actionTransport();
    const { result } = renderActions({ transport });

    act(() => result.current.openLeaveDialog({ ...organizationSummary, myRole: "owner" }));
    await act(() => result.current.leaveOrganizationRequest());
    expect(result.current.actionMessage).toBe("组织所有者不能直接退出，请先转移所有权。");

    act(() => result.current.openInviteDialog({ ...organizationSummary, myRole: "member" }));
    await act(() => result.current.inviteOrganizationMember({ role: "member", targetSubject: "user:invitee" }));
    expect(result.current.actionMessage).toBe("当前组织角色无权邀请成员。");
    expect(transport).not.toHaveBeenCalled();
  });

  test("requires login and create permission", async () => {
    const unauthenticated = renderActions({ session: null });
    await act(() => unauthenticated.result.current.joinOrganizationRequest(`orginv_${"d".repeat(43)}`));
    expect(unauthenticated.result.current.actionMessage).toBe("请先登录 Liteasy 账号再管理组织。");

    const forbidden = renderActions({ canCreateOrganization: false });
    act(() => forbidden.result.current.openCreateDialog());
    await act(() => forbidden.result.current.createOrganizationRequest("Research Lab"));
    expect(forbidden.result.current.createOpen).toBe(false);
    expect(forbidden.result.current.actionMessage).toBe("当前账号无创建组织权限；你可以加入已有组织。");
  });

  test("resets all organization action state without emitting a success message", () => {
    const { onAnalysisHint, result } = renderActions();
    act(() => {
      result.current.openCreateDialog();
      result.current.openJoinDialog();
      result.current.openInviteDialog(organizationSummary);
      result.current.openLeaveDialog(organizationSummary);
      result.current.resetOrganizationActions();
    });
    expect(result.current.createOpen).toBe(false);
    expect(result.current.joinOpen).toBe(false);
    expect(result.current.inviteSummary).toBeNull();
    expect(result.current.leaveSummary).toBeNull();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });
});

test.each(["create", "join", "invite", "leave"] as const)("ignores a late %s receipt after the account changes", async (operation) => {
  let finish!: (response: Response) => void;
  const transport = vi.fn<OrganizationActionTransport>(() => new Promise((resolve) => { finish = resolve; }));
  const onOrganizationChanged = vi.fn();
  const onAnalysisHint = vi.fn();
  const { result, rerender } = renderHook(({ session }) => useOrganizationActions({ accountSession: session, canCreateOrganization: true, controlPlaneEndpoint: "https://cloud.example", onOrganizationChanged, onAnalysisHint, transport }), { initialProps: { session: accountSession } });
  act(() => { result.current.openInviteDialog({ ...organizationSummary, myRole: "owner" }); result.current.openLeaveDialog(organizationSummary); });
  let pending!: Promise<void>;
  act(() => { pending = operation === "create" ? result.current.createOrganizationRequest("Account A organization") : operation === "join" ? result.current.joinOrganizationRequest("synthetic-token") : operation === "invite" ? result.current.inviteOrganizationMember({ role: "member", targetSubject: "recipient-a" }) : result.current.leaveOrganizationRequest(); });
  rerender({ session: { ...accountSession, userId: "other-user", sessionId: "other-token" } });
  await act(async () => {
    finish(jsonResponse({ organization: { organizationId: "old-org", name: "Account A organization" }, organizationId: "old-org", invitation: { invitationToken: "OLD_ACCOUNT_SECRET_TOKEN" } }));
    await pending;
  });
  expect(onOrganizationChanged).not.toHaveBeenCalled();
  expect(onAnalysisHint).not.toHaveBeenCalled();
  expect(result.current.actionMessage).toBeUndefined();
  expect(result.current.inviteSummary).toBeNull();
  expect(result.current.leaveSummary).toBeNull();
  expect(result.current.actionPending).toBe(false);
});

test.each(["endpoint", "reset"] as const)("invalidates an invitation receipt after %s changes", async (change) => {
  let finish!: (response: Response) => void;
  const transport = vi.fn<OrganizationActionTransport>(() => new Promise((resolve) => { finish = resolve; }));
  const onOrganizationChanged = vi.fn();
  const onAnalysisHint = vi.fn();
  const { result, rerender } = renderHook(({ endpoint }) => useOrganizationActions({ accountSession, controlPlaneEndpoint: endpoint, onOrganizationChanged, onAnalysisHint, transport }), { initialProps: { endpoint: "https://cloud.example" } });
  act(() => result.current.openInviteDialog({ ...organizationSummary, myRole: "owner" }));
  let pending!: Promise<void>;
  act(() => { pending = result.current.inviteOrganizationMember({ role: "member", targetSubject: "recipient-a" }); });
  if (change === "endpoint") rerender({ endpoint: "https://other-cloud.example" });
  else act(() => result.current.resetOrganizationActions());
  await act(async () => { finish(jsonResponse({ invitation: { invitationToken: "OLD_ENDPOINT_TOKEN" } })); await pending; });
  expect(onOrganizationChanged).not.toHaveBeenCalled();
  expect(onAnalysisHint).not.toHaveBeenCalled();
  expect(result.current.actionMessage).toBeUndefined();
});

test("does not send a session to a different service endpoint", async () => {
  const transport = actionTransport();
  const { result } = renderActions({ session: { ...accountSession, endpoint: "https://original.example" }, transport });
  await act(() => result.current.joinOrganizationRequest("synthetic-token"));
  expect(transport).not.toHaveBeenCalled();
  expect(result.current.actionMessage).toContain("服务地址");
});


test("requires verified subject, issuer and endpoint and never copies invitation tokens into analysis hints", async () => {
  for (const missing of ["userId", "issuer", "endpoint"] as const) {
    const transport = actionTransport();
    const { result, unmount } = renderActions({ session: { ...accountSession, [missing]: undefined }, transport });
    await act(() => result.current.joinOrganizationRequest("synthetic-token"));
    expect(transport).not.toHaveBeenCalled();
    unmount();
  }
  const { result, onAnalysisHint } = renderActions();
  act(() => result.current.openInviteDialog({ ...organizationSummary, myRole: "owner" }));
  await act(() => result.current.inviteOrganizationMember({ role: "member", targetSubject: "recipient-a" }));
  expect(result.current.actionMessage).toContain("orginv_");
  expect(JSON.stringify(onAnalysisHint.mock.calls)).not.toContain("orginv_");
});


test("late failed requests cannot display an old account error after reset", async () => {
  let reject!: (error: Error) => void;
  const transport = vi.fn<OrganizationActionTransport>(() => new Promise((_, fail) => { reject = fail; }));
  const { result, onAnalysisHint } = renderActions({ transport });
  let pending!: Promise<void>;
  act(() => { pending = result.current.joinOrganizationRequest("synthetic-old-token"); });
  act(() => result.current.resetOrganizationActions());
  await act(async () => { reject(new Error("OLD_ACCOUNT_PRIVATE_ERROR")); await pending; });
  expect(result.current.actionMessage).toBeUndefined();
  expect(onAnalysisHint).not.toHaveBeenCalled();
});


test("an old action callback cannot start a request after switching account or unmounting", async () => {
  const transport = actionTransport(), onAnalysisHint = vi.fn();
  const { result, rerender, unmount } = renderHook(({ session }) => useOrganizationActions({ accountSession: session,
    canCreateOrganization: true, controlPlaneEndpoint: "https://cloud.example", onAnalysisHint, transport }), { initialProps: { session: accountSession } });
  const oldCreate = result.current.createOrganizationRequest;
  rerender({ session: { ...accountSession, userId: "new-user", sessionId: "new-token" } });
  await act(() => oldCreate("Old actor organization"));
  const oldJoin = result.current.joinOrganizationRequest;
  unmount();
  await act(() => oldJoin("synthetic-token"));
  expect(transport).not.toHaveBeenCalled();
  expect(onAnalysisHint).not.toHaveBeenCalled();
});
