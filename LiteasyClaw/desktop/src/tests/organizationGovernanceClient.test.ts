import { createOrganizationGovernanceClient } from "../app/features/organization/organizationGovernanceClient";

test("posts organization and session ids to the governance summary endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createOrganizationGovernanceClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          summary: {
            auditQueue: {
              highRisk: 1,
              pendingReview: 3
            },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [
              {
                id: "audit-1",
                label: "Admin 更新共享文献库上传权限",
                risk: "medium"
              }
            ],
            runningTasks: [
              {
                id: "task-1",
                label: "组织共享文献库索引刷新",
                status: "running"
              }
            ]
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const summary = await client({ organizationId: "org-demo-1", sessionId: "demo-session-1" });

  expect(summary.auditQueue.pendingReview).toBe(3);
  expect(summary.runningTasks[0].label).toBe("组织共享文献库索引刷新");
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        organizationId: "org-demo-1",
        sessionId: "demo-session-1"
      }),
      url: "https://liteasy.example.com/control-plane/v1/org/governance-summary"
    }
  ]);
});
