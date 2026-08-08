import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useOrganizationData } from "../app/features/organization/useOrganizationData";
import type { AccountSession } from "../app/features/account/account.types";

const accountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

function createJsonResponse(payload: unknown) {
  return {
    json: async () => payload,
    ok: true,
    status: 200
  } as Response;
}

describe("useOrganizationData", () => {
  test("loads the organization list and selected organization summary", async () => {
    const organizationListRequests: string[] = [];
    const organizationSummaryRequests: string[] = [];

    const getActiveOrganizationId = () => "org-demo-2";
    const organizationListTransport = async (request: { body?: string }) => {
      organizationListRequests.push(request.body ?? "");
      return createJsonResponse({
        activeOrganizationId: "org-demo-1",
        organizations: [
          {
            memberCount: 12,
            myRole: "member",
            name: "Liteasy AI Reading Lab",
            organizationId: "org-demo-1",
            sharedLibraryName: "组织共享文献库"
          },
          {
            memberCount: 4,
            myRole: "admin",
            name: "Liteasy Literature Ops",
            organizationId: "org-demo-2",
            sharedLibraryName: "文献运营共享库"
          }
        ]
      });
    };
    const organizationTransport = async (request: { body?: string }) => {
      organizationSummaryRequests.push(request.body ?? "");
      return createJsonResponse({
        summary: {
          auditEvents: [],
          memberCount: 4,
          members: [],
          myRole: "admin",
          name: "Liteasy Literature Ops",
          notifications: [],
          organizationId: "org-demo-2",
          quota: {
            periodEndsAt: "2026-06-01T00:00:00Z",
            storageLimitGb: 50,
            storageUsedGb: 12
          },
          sharedLibrary: {
            documentCount: 16,
            documents: [],
            name: "文献运营共享库",
            status: "available"
          },
          taskSummary: {
            failed: 0,
            running: 1
          }
        }
      });
    };

    const { result } = renderHook(() =>
      useOrganizationData({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        getActiveOrganizationId,
        organizationListTransport,
        organizationTransport
      })
    );

    await waitFor(() => {
      expect(result.current.organizationSummary?.organizationId).toBe("org-demo-2");
    });

    expect(result.current.organizationList?.activeOrganizationId).toBe("org-demo-1");
    expect(result.current.activeOrganizationId).toBe("org-demo-2");
    expect(organizationListRequests.map((body) => JSON.parse(body))).toEqual([
      { sessionId: "demo-session-1" }
    ]);
    expect(organizationSummaryRequests.map((body) => JSON.parse(body))).toContainEqual({
      organizationId: "org-demo-2",
      sessionId: "demo-session-1"
    });
  });
  test("does not request an organization summary when the account has no organization", async () => {
    const organizationSummaryRequests: string[] = [];
    const organizationTransport = async (request: { body: string }) => {
      organizationSummaryRequests.push(request.body);
      return new Promise<Response>(() => undefined);
    };
    const organizationListTransport = async () => createJsonResponse({
      activeOrganizationId: "org-demo-1",
      organizations: []
    });

    const { result } = renderHook(() =>
      useOrganizationData({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        getActiveOrganizationId: () => undefined,
        organizationListTransport,
        organizationTransport
      })
    );

    await waitFor(() => {
      expect(result.current.organizationListStatus).toBe("success");
    });

    expect(result.current.organizationSummaryStatus).toBe("idle");
    expect(result.current.organizationSummary).toBeNull();
    expect(result.current.organizationSummaryMessage).toBe("尚未加入组织。");
    expect(organizationSummaryRequests).toEqual([]);
  });

  test("shows a stable error without exposing the endpoint when organization requests fail", async () => {
    const networkFailure = async () => {
      throw new TypeError("Failed to fetch");
    };

    const { result } = renderHook(() =>
      useOrganizationData({
        accountSession,
        controlPlaneEndpoint: "http://127.0.0.1:8787",
        getActiveOrganizationId: () => undefined,
        organizationListTransport: networkFailure,
        organizationTransport: networkFailure
      })
    );

    await waitFor(() => {
      expect(result.current.organizationListStatus).toBe("error");
      expect(result.current.organizationSummaryStatus).toBe("idle");
    });

    expect(result.current.organizationListMessage).toContain("云端服务当前不可用，请检查网络连接后重试");
    expect(result.current.organizationSummaryMessage).toBe("尚未加入组织。");
    expect(result.current.organizationListMessage).not.toContain("http://127.0.0.1:8787");
  });

  test("keeps organization space in local-reader guidance mode when logged out", async () => {
    const { result } = renderHook(() =>
      useOrganizationData({
        accountSession: null,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        getActiveOrganizationId: () => undefined
      })
    );

    await waitFor(() => {
      expect(result.current.organizationSummaryStatus).toBe("unauthenticated");
    });

    expect(result.current.organizationSummaryMessage).toBe(
      "当前已退化为本地阅读器，组织空间不可用。联网并登录后，将自动恢复云端能力。"
    );
    expect(result.current.organizationListMessage).toBe(
      "当前已退化为本地阅读器，组织列表不可用。联网并登录后，将自动恢复云端能力。"
    );
  });

});
