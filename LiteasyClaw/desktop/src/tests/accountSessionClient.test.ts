import {
  createAccountSessionClient,
  loginCloudAccount,
  logoutCloudAccount,
  registerCloudAccount,
  validateCloudAccountSession
} from "../app/features/account/accountSessionClient";

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
            membershipTier: "pro",
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
    membershipTier: "pro",
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

test("posts a personal account registration request to the cloud account endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];

  const session = await registerCloudAccount({
    displayName: "Tian",
    email: "tian@example.com",
    endpoint: "https://liteasy.example.com/control-plane",
    password: "private-password-1",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          session: {
            email: "tian@example.com",
            expiresAt: "2026-06-30T09:30:00Z",
            membershipTier: "pro",
            name: "Tian",
            sessionId: "account-session-tian-example-com"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(session).toEqual({
    email: "tian@example.com",
    expiresAt: "2026-06-30T09:30:00Z",
    membershipTier: "pro",
    name: "Tian",
    sessionId: "account-session-tian-example-com"
  });
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        displayName: "Tian",
        email: "tian@example.com",
        password: "private-password-1"
      }),
      url: "https://liteasy.example.com/control-plane/v1/account/register"
    }
  ]);
});

test("surfaces the cloud account registration error message", async () => {
  await expect(
    registerCloudAccount({
      displayName: "Tian",
      email: "tian@example.com",
      endpoint: "https://liteasy.example.com/control-plane",
      password: "private-password-1",
      transport: async () => ({
        json: async () => ({
          message: "该邮箱已经注册，请直接登录。"
        }),
        ok: false,
        status: 409
      })
    })
  ).rejects.toThrow("该邮箱已经注册，请直接登录。");
});

test("logs in, validates, and logs out a real cloud account session", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const session = {
    email: "tian@example.com",
    expiresAt: "2026-07-10T09:30:00Z",
    membershipTier: "pro" as const,
    name: "Tian",
    sessionId: `ltsy_${"a".repeat(43)}`,
    userId: "user-1"
  };
  const transport = async (request: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
    url: string;
  }) => {
    requests.push({ body: request.body, url: request.url });
    return {
      json: async () => ({ session }),
      ok: true,
      status: 200
    };
  };

  await expect(
    loginCloudAccount({
      email: "tian@example.com",
      endpoint: "https://liteasy.example.com/control-plane",
      password: "private-password-1",
      transport
    })
  ).resolves.toEqual(session);

  await expect(
    validateCloudAccountSession({
      endpoint: "https://liteasy.example.com/control-plane",
      sessionId: session.sessionId,
      transport
    })
  ).resolves.toEqual(session);

  await logoutCloudAccount({
    endpoint: "https://liteasy.example.com/control-plane",
    sessionId: session.sessionId,
    transport
  });

  expect(requests.map((request) => request.url)).toEqual([
    "https://liteasy.example.com/control-plane/v1/account/login",
    "https://liteasy.example.com/control-plane/v1/account/session",
    "https://liteasy.example.com/control-plane/v1/account/logout"
  ]);
});
