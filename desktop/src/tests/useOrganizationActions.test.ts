import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useOrganizationActions } from "../app/features/organization/useOrganizationActions";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

const organizationSummary: OrganizationSummary = {
  auditEvents: [],
  memberCount: 12,
  members: [],
  myRole: "研究员",
  name: "Liteasy AI Reading Lab",
  notifications: [
    {
      createdAt: "2026-05-14T08:00:00Z",
      id: "notice-1",
      message: "管理员发布了本周阅读主题。",
      type: "announcement"
    }
  ],
  organizationId: "org-demo-1",
  quota: {
    periodEndsAt: "2026-06-01T00:00:00Z",
    storageLimitGb: 100,
    storageUsedGb: 38
  },
  sharedLibrary: {
    documentCount: 48,
    documents: [],
    name: "组织共享文献库",
    status: "available"
  },
  taskSummary: {
    failed: 1,
    running: 2
  }
};

describe("useOrganizationActions", () => {
  test("tracks organization action dialogs and returns productized seam messages", () => {
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() => useOrganizationActions({ onAnalysisHint }));

    act(() => result.current.openCreateDialog());
    expect(result.current.createOpen).toBe(true);

    act(() => result.current.createDemoOrganizationRequest("Liteasy Demo Organization"));
    expect(result.current.createOpen).toBe(false);
    expect(result.current.actionMessage).toBe(
      "已提交创建组织“Liteasy Demo Organization”的申请，当前为演示环境记录。"
    );
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "已提交创建组织“Liteasy Demo Organization”的申请，当前为演示环境记录。"
    );

    act(() => result.current.openJoinDialog());
    expect(result.current.joinOpen).toBe(true);

    act(() => result.current.createDemoOrganizationJoinRequest("LITEASY-DEMO-JOIN"));
    expect(result.current.joinOpen).toBe(false);
    expect(result.current.actionMessage).toBe(
      "已提交加入组织的邀请码 LITEASY-DEMO-JOIN，当前为演示环境记录；你的组织角色与成员关系暂不会立即变更。"
    );
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "已提交加入组织的邀请码 LITEASY-DEMO-JOIN，当前为演示环境记录；你的组织角色与成员关系暂不会立即变更。"
    );

    act(() => result.current.openInviteDialog(organizationSummary));
    expect(result.current.inviteSummary?.organizationId).toBe("org-demo-1");

    act(() => result.current.sendDemoOrganizationInvite());
    expect(result.current.inviteSummary).toBeNull();
    expect(result.current.actionMessage).toBe(
      "已创建面向 Liteasy AI Reading Lab 的邀请，当前为演示环境记录。"
    );
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "已创建面向 Liteasy AI Reading Lab 的邀请，当前为演示环境记录。"
    );

    act(() => result.current.openLeaveDialog(organizationSummary));
    expect(result.current.leaveSummary?.organizationId).toBe("org-demo-1");

    act(() => result.current.createDemoOrganizationLeaveRequest());
    expect(result.current.leaveSummary).toBeNull();
    expect(result.current.actionMessage).toBe(
      "已提交退出 Liteasy AI Reading Lab 的请求，当前为演示环境记录。"
    );
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "已提交退出 Liteasy AI Reading Lab 的请求，当前为演示环境记录。"
    );
  });

  test("makes join feedback explicit that membership does not switch immediately", () => {
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() => useOrganizationActions({ onAnalysisHint }));

    act(() => result.current.createDemoOrganizationJoinRequest("LITEASY-DEMO-JOIN"));

    expect(result.current.actionMessage).toBe(
      "已提交加入组织的邀请码 LITEASY-DEMO-JOIN，当前为演示环境记录；你的组织角色与成员关系暂不会立即变更。"
    );
  });

  test("resets organization action dialogs without emitting messages", () => {
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() => useOrganizationActions({ onAnalysisHint }));

    act(() => {
      result.current.openCreateDialog();
      result.current.openJoinDialog();
      result.current.openInviteDialog(organizationSummary);
      result.current.openLeaveDialog(organizationSummary);
    });

    act(() => result.current.resetOrganizationActions());

    expect(result.current.createOpen).toBe(false);
    expect(result.current.joinOpen).toBe(false);
    expect(result.current.inviteSummary).toBeNull();
    expect(result.current.leaveSummary).toBeNull();
    expect(result.current.actionMessage).toBeUndefined();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });
});
