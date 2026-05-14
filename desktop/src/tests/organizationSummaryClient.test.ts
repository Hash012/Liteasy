import { createOrganizationSummaryClient } from "../app/features/organization/organizationSummaryClient";

test("posts a session id to the organization summary endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createOrganizationSummaryClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          summary: {
            auditEvents: [
              {
                actor: "Admin",
                description: "更新共享文献库上传权限",
                id: "audit-1",
                occurredAt: "2026-05-14T10:30:00Z"
              }
            ],
            memberCount: 12,
            members: [
              {
                id: "member-1",
                name: "Liteasy Researcher",
                role: "研究员"
              },
              {
                id: "member-2",
                name: "Admin",
                role: "管理员"
              }
            ],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [
              {
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
              documents: [
                {
                  id: "org-doc-1",
                  sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                  title: "Organization Reading List: Retrieval-Augmented Generation"
                },
                {
                  id: "org-doc-2",
                  sourcePath: "org://org-demo-1/shared-library/org-doc-2.pdf",
                  title: "Team Notes on Long-Context Evaluation"
                }
              ],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const summary = await client({ sessionId: "demo-session-1" });

  expect(summary.name).toBe("Liteasy AI Reading Lab");
  expect(summary.members.map((member) => member.name)).toEqual(["Liteasy Researcher", "Admin"]);
  expect(summary.sharedLibrary.documentCount).toBe(48);
  expect(summary.sharedLibrary.documents).toHaveLength(2);
  expect(requests).toEqual([
    {
      body: JSON.stringify({ sessionId: "demo-session-1" }),
      url: "https://liteasy.example.com/control-plane/v1/org/summary"
    }
  ]);
});

test("posts a selected organization id when loading organization summary", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createOrganizationSummaryClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 4,
            members: [],
            myRole: "管理员",
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
        }),
        ok: true,
        status: 200
      };
    }
  });

  const summary = await client({ organizationId: "org-demo-2", sessionId: "demo-session-1" });

  expect(summary.name).toBe("Liteasy Literature Ops");
  expect(requests).toEqual([
    {
      body: JSON.stringify({ organizationId: "org-demo-2", sessionId: "demo-session-1" }),
      url: "https://liteasy.example.com/control-plane/v1/org/summary"
    }
  ]);
});
