import { createOrganizationListClient } from "../app/features/organization/organizationListClient";

test("posts a session id to the organization list endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createOrganizationListClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
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
        }),
        ok: true,
        status: 200
      };
    }
  });

  const list = await client({ sessionId: "demo-session-1" });

  expect(list.activeOrganizationId).toBe("org-demo-1");
  expect(list.organizations.map((organization) => organization.name)).toEqual([
    "Liteasy AI Reading Lab",
    "Liteasy Literature Ops"
  ]);
  expect(requests[0]).toEqual({
    body: JSON.stringify({ sessionId: "demo-session-1" }),
    url: "https://liteasy.example.com/control-plane/v1/org/list"
  });
});

test("normalizes legacy organization list roles into the formal role model", async () => {
  const client = createOrganizationListClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async () => ({
      json: async () => ({
        activeOrganizationId: "org-demo-1",
        organizations: [
          {
            memberCount: 12,
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            organizationId: "org-demo-1",
            sharedLibraryName: "组织共享文献库"
          }
        ]
      }),
      ok: true,
      status: 200
    })
  });

  const list = await client({ sessionId: "demo-session-1" });

  expect(list.organizations[0].myRole).toBe("member");
});
