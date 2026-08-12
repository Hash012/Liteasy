import { expect, test, vi } from "vitest";
import {
  adminLoginRequest,
  loadAdminIdentityConfiguration,
  validateAdminIdentityConfiguration
} from "../auth";

const config = {
  cloudUrl: "https://api.liteasy.example",
  forumUrl: "https://forum.liteasy.example",
  identityUrl: "https://identity.liteasy.example"
};

test("requires an explicit fresh login for every admin authorization", () => {
  expect(adminLoginRequest).toEqual({ max_age: 0, prompt: "login" });
});

test("accepts only an audience-bound public admin PKCE configuration", () => {
  expect(validateAdminIdentityConfiguration({
    audience: "liteasy-admin",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-admin-public",
    issuer: "https://identity.liteasy.example"
  })).toEqual({
    audience: "liteasy-admin",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-admin-public",
    issuer: "https://identity.liteasy.example"
  });

  for (const candidate of [
    { audience: "liteasy-desktop", authorizationFlow: "authorization_code_pkce", clientId: "admin", issuer: "https://identity.example" },
    { audience: "liteasy-admin", authorizationFlow: "implicit", clientId: "admin", issuer: "https://identity.example" },
    { audience: "liteasy-admin", authorizationFlow: "authorization_code_pkce", clientId: "bad client", issuer: "https://identity.example" },
    { audience: "liteasy-admin", authorizationFlow: "authorization_code_pkce", clientId: "admin", issuer: "http://identity.example" },
    { audience: "liteasy-admin", authorizationFlow: "authorization_code_pkce", clientId: "admin", issuer: "https://user:secret@identity.example" }
  ]) {
    expect(() => validateAdminIdentityConfiguration(candidate)).toThrow("admin_oauth_configuration_invalid");
  }
});

test("loads admin identity metadata from the cloud without credentials", async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
    audience: "liteasy-admin",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-admin-public",
    issuer: "https://identity.liteasy.example"
  }), { status: 200 }));

  await expect(loadAdminIdentityConfiguration(config, fetchImpl)).resolves.toMatchObject({
    audience: "liteasy-admin",
    clientId: "liteasy-admin-public"
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.liteasy.example/v1/identity/admin-config",
    expect.objectContaining({ method: "GET" })
  );
  expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ Accept: "application/json" });
});
