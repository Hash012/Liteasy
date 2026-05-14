import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useOrganizationNotifications } from "../app/features/organization/useOrganizationNotifications";
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
    },
    {
      createdAt: "2026-05-14T09:00:00Z",
      id: "notice-2",
      message: "成员上传了 Graph Neural Networks 综述。",
      type: "document_upload"
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

afterEach(() => {
  window.localStorage.clear();
});

describe("useOrganizationNotifications", () => {
  test("marks organization notifications read with organization-scoped keys", () => {
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() => useOrganizationNotifications({ onAnalysisHint }));

    act(() => result.current.markOrganizationNotificationsRead(organizationSummary));

    expect(result.current.readNotificationIds).toEqual(["org-demo-1:notice-1", "org-demo-1:notice-2"]);
    expect(onAnalysisHint).toHaveBeenCalledWith("组织通知已全部标记为已读。");
    expect(window.localStorage.getItem("liteasy.organization.notifications.read.v1"))
      .toBe('["org-demo-1:notice-1","org-demo-1:notice-2"]');
  });

  test("restores and clears persisted notification read state", () => {
    window.localStorage.setItem(
      "liteasy.organization.notifications.read.v1",
      '["org-demo-1:notice-1"]'
    );
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() => useOrganizationNotifications({ onAnalysisHint }));

    expect(result.current.readNotificationIds).toEqual(["org-demo-1:notice-1"]);

    act(() => result.current.clearOrganizationNotifications());

    expect(result.current.readNotificationIds).toEqual([]);
    expect(window.localStorage.getItem("liteasy.organization.notifications.read.v1")).toBeNull();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });
});
