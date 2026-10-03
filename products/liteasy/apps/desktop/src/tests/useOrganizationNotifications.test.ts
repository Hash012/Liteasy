import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useOrganizationNotifications } from "../app/features/organization/useOrganizationNotifications";
import { accountActorStorageKey } from "../app/features/account/accountSessionBinding";
import { storeOrganizationReadNotificationKeys, loadStoredOrganizationReadNotificationKeys } from "../app/features/organization/organizationNotificationStorage";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

const accountSession = { email: "a@example.test", name: "A", expiresAt: "2099-01-01T00:00:00Z", endpoint: "https://api.example.test", issuer: "https://idp.example.test", userId: "a", sessionId: "token-a" };
const actorKey = accountActorStorageKey(accountSession, accountSession.endpoint)!;
const accountOptions = { accountSession, controlPlaneEndpoint: accountSession.endpoint };

const organizationSummary: OrganizationSummary = {
  auditEvents: [],
  memberCount: 12,
  members: [],
  myMemberRevision: 0,
  myRole: "member",
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
    configured: true,
    periodEndsAt: "2026-06-01T00:00:00Z",
    storageLimitGb: 100,
    storageUsedGb: 38
  },
  revision: 0,
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
    const { result } = renderHook(() => useOrganizationNotifications({ ...accountOptions, onAnalysisHint }));

    act(() => result.current.markOrganizationNotificationsRead(organizationSummary));

    expect(result.current.readNotificationIds).toEqual(["org-demo-1:notice-1", "org-demo-1:notice-2"]);
    expect(onAnalysisHint).toHaveBeenCalledWith("通知已在此设备标记为已读；邀请或任务仍需单独处理。");
    expect(loadStoredOrganizationReadNotificationKeys(actorKey)).toEqual(["org-demo-1:notice-1", "org-demo-1:notice-2"]);
  });

  test("restores actor read state and clears only the active view", () => {
    storeOrganizationReadNotificationKeys(["org-demo-1:notice-1"], actorKey);
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() => useOrganizationNotifications({ ...accountOptions, onAnalysisHint }));

    expect(result.current.readNotificationIds).toEqual(["org-demo-1:notice-1"]);

    act(() => result.current.clearOrganizationNotifications());

    expect(result.current.readNotificationIds).toEqual([]);
    expect(loadStoredOrganizationReadNotificationKeys(actorKey)).toEqual(["org-demo-1:notice-1"]);
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });
});

test("does not reuse A's read state for B and restores A's state after logout", () => {
  const onAnalysisHint = vi.fn();
  const sessionFor = (id: string) => ({ email: `${id}@example.test`, name: id, expiresAt: "2099-01-01T00:00:00Z", endpoint: "https://api.example.test", issuer: "https://idp.example.test", userId: id, sessionId: `token-${id}` });
  const { result, rerender } = renderHook(({ accountSession }) => useOrganizationNotifications({ onAnalysisHint, accountSession, controlPlaneEndpoint: "https://api.example.test" }), { initialProps: { accountSession: sessionFor("a") } });
  act(() => result.current.markOrganizationNotificationsRead(organizationSummary));
  rerender({ accountSession: sessionFor("b") });
  expect(result.current.readNotificationIds).toEqual([]);
  act(() => result.current.clearOrganizationNotifications());
  rerender({ accountSession: sessionFor("a") });
  expect(result.current.readNotificationIds).toEqual(["org-demo-1:notice-1", "org-demo-1:notice-2"]);
});
