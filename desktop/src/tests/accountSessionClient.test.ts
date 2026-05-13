import { createAccountSessionClient } from "../app/features/account/accountSessionClient";

test("posts a demo login request to the cloud account endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createAccountSessionClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const session = await client();

  expect(session).toEqual({
    email: "researcher@liteasy.dev",
    expiresAt: "2026-05-15T09:30:00Z",
    name: "Liteasy Researcher",
    sessionId: "demo-session-1"
  });
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        mode: "demo_login"
      }),
      url: "https://liteasy.example.com/control-plane/v1/account/demo-login"
    }
  ]);
});
