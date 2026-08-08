import { expect, test, vi } from "vitest";
import {
  createAuthenticatedCloudAccountSession,
  createRegisteredCloudAccountSession
} from "../app/features/account/accountSessionRuntime";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

test("never sends account passwords to a non-loopback control plane", async () => {
  const settings = createSeededSettingsStore({
    "models.control_plane_endpoint": "https://api.liteasy.example"
  }).getState();
  const transport = vi.fn();

  await expect(createAuthenticatedCloudAccountSession(settings, {
    email: "ada@example.com",
    password: "private-password"
  }, { transport })).rejects.toThrow("development_account_endpoint_required");
  await expect(createRegisteredCloudAccountSession(settings, {
    displayName: "Ada",
    email: "ada@example.com",
    password: "private-password"
  }, { transport })).rejects.toThrow("development_account_endpoint_required");
  expect(transport).not.toHaveBeenCalled();
});

test("retains the real password API only for the explicit local development service", async () => {
  const settings = createSeededSettingsStore({
    "models.control_plane_endpoint": "http://127.0.0.1:8787"
  }).getState();
  const transport = vi.fn(async () => ({
    json: async () => ({
      session: {
        email: "ada@example.com",
        expiresAt: "2026-08-07T00:00:00.000Z",
        membershipTier: "basic",
        name: "Ada",
        sessionId: "ltsy_local_session",
        userId: "user-1"
      }
    }),
    ok: true,
    status: 200
  }));

  await expect(createAuthenticatedCloudAccountSession(settings, {
    email: "ada@example.com",
    password: "private-password"
  }, { transport })).resolves.toMatchObject({ sessionId: "ltsy_local_session" });
  expect(transport).toHaveBeenCalledTimes(1);
});
