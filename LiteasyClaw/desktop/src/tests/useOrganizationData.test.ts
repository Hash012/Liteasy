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
  test("loads list, selected summary, and selected governance data", async () => {
    const organizationListRequests: string[] = [];
    const organizationSummaryRequests: string[] = [];
    const governanceRequests: string[] = [];

    const getActiveOrganizationId = () => "org-demo-2";
    const organizationGovernanceTransport = async (request: { body?: string }) => {
      governanceRequests.push(request.body ?? "");
      return createJsonResponse({
        summary: {
          auditQueue: { highRisk: 0, pendingReview: 1 },
          quota: {
            modelCallsLimit: 5000,
            modelCallsUsed: 900,
            storageLimitGb: 50,
            storageUsedGb: 12
          },
          recentAuditEvents: [],
          runningTasks: []
        }
      });
    };
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
        organizationGovernanceTransport,
        organizationListTransport,
        organizationTransport
      })
    );

    await waitFor(() => {
      expect(result.current.organizationSummary?.organizationId).toBe("org-demo-2");
      expect(result.current.organizationGovernanceSummary?.auditQueue.pendingReview).toBe(1);
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
    expect(governanceRequests.map((body) => JSON.parse(body))).toContainEqual({
      organizationId: "org-demo-2",
      sessionId: "demo-session-1"
    });
  });
  test("keeps governance waiting while organization summary is still loading", async () => {
    const neverResolveSummary = async () => new Promise<Response>(() => undefined);

    const { result } = renderHook(() =>
      useOrganizationData({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        getActiveOrganizationId: () => undefined,
        organizationGovernanceTransport: async () => createJsonResponse({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 0 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 0,
              storageLimitGb: 100,
              storageUsedGb: 0
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        organizationListTransport: async () => createJsonResponse({
          activeOrganizationId: "org-demo-1",
          organizations: []
        }),
        organizationTransport: neverResolveSummary
      })
    );

    await waitFor(() => {
      expect(result.current.organizationSummaryStatus).toBe("loading");
    });

    expect(result.current.organizationGovernanceStatus).toBe("waiting");
    expect(result.current.organizationGovernanceMessage).toBe("组织空间加载完成后会同步组织治理摘要。");
  });

  test("shows an actionable dev-cloud hint when organization requests cannot reach the service", async () => {
    const networkFailure = async () => {
      throw new TypeError("Failed to fetch");
    };

    const { result } = renderHook(() =>
      useOrganizationData({
        accountSession,
        controlPlaneEndpoint: "http://127.0.0.1:8787",
        getActiveOrganizationId: () => undefined,
        organizationGovernanceTransport: networkFailure,
        organizationListTransport: networkFailure,
        organizationTransport: networkFailure
      })
    );

    await waitFor(() => {
      expect(result.current.organizationListStatus).toBe("error");
      expect(result.current.organizationSummaryStatus).toBe("error");
    });

    expect(result.current.organizationListMessage).toContain("请确认服务已启动，并检查当前云端地址：http://127.0.0.1:8787");
    expect(result.current.organizationSummaryMessage).toContain("请确认服务已启动，并检查当前云端地址：http://127.0.0.1:8787");
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
