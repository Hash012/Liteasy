import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AccountSession } from "../app/features/account/account.types";
import type { OrganizationActionTransport } from "../app/features/organization/organizationActionsClient";
import { useOrganizationActions } from "../app/features/organization/useOrganizationActions";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

const accountSession: AccountSession = {
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
    controlPlaneEndpoint: "http://127.0.0.1:8787",
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
