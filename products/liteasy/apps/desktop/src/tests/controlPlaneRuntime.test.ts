import { beforeEach, expect, test } from "vitest";
import { fetchModelPolicySnapshot } from "../app/features/models/controlPlaneRuntime";
import {
  clearTrustedModelProxyEndpointsForTests,
  isTrustedRemoteModelProxyEndpoint
} from "../app/features/models/modelProxyTrust";
import { createSettingsStore } from "../app/features/settings/settings.store";

beforeEach(() => clearTrustedModelProxyEndpointsForTests());

test("trusts the remote model proxy only after a successful control-plane snapshot", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.control_plane_endpoint",
    value: "https://control.customer.example"
  });
  const cloudProxyEndpoint = "https://models.customer.example/liteasy";

  expect(isTrustedRemoteModelProxyEndpoint(cloudProxyEndpoint)).toBe(false);
  await fetchModelPolicySnapshot(store.getState(), {
    sessionId: "desktop-session",
    transport: async () => ({
      json: async () => ({
        cloudProxyEndpoint,
        defaultProvider: "openai"
      }),
      ok: true,
      status: 200
    })
  });

  expect(isTrustedRemoteModelProxyEndpoint(cloudProxyEndpoint)).toBe(true);
});

test("does not trust a remote model proxy when control-plane sync fails", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.control_plane_endpoint",
    value: "https://control.customer.example"
  });
  const cloudProxyEndpoint = "https://attacker.example/model";

  await expect(fetchModelPolicySnapshot(store.getState(), {
    sessionId: "desktop-session",
    transport: async () => ({
      json: async () => ({ cloudProxyEndpoint }),
      ok: false,
      status: 403
    })
  })).rejects.toThrow("云端策略同步失败");

  expect(isTrustedRemoteModelProxyEndpoint(cloudProxyEndpoint)).toBe(false);
});

test("replaces the trusted remote proxy when the control-plane policy rotates", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.control_plane_endpoint",
    value: "https://control.customer.example"
  });
  const firstEndpoint = "https://models-a.customer.example/liteasy";
  const nextEndpoint = "https://models-b.customer.example/liteasy";

  for (const cloudProxyEndpoint of [firstEndpoint, nextEndpoint]) {
    await fetchModelPolicySnapshot(store.getState(), {
      sessionId: "desktop-session",
      transport: async () => ({
        json: async () => ({
          cloudProxyEndpoint,
          defaultProvider: "openai"
        }),
        ok: true,
        status: 200
      })
    });
  }

  expect(isTrustedRemoteModelProxyEndpoint(firstEndpoint)).toBe(false);
  expect(isTrustedRemoteModelProxyEndpoint(nextEndpoint)).toBe(true);
});
