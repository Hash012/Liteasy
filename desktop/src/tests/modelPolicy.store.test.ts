import { createSettingsStore } from "../app/features/settings/settings.store";

test("stores cloud-governed model access policy defaults", () => {
  const store = createSettingsStore();

  expect(store.getState()["models.access_mode"]).toBe("cloud_proxy");
  expect(store.getState()["models.local_direct_enabled"]).toBe(false);
  expect(store.getState()["models.default_provider"]).toBe("openai");
  expect(store.getState()["models.cloud_proxy_endpoint"]).toBe("mock://cloud-proxy");
  expect(store.getState()["models.local_direct_endpoint"]).toBe("mock://local-direct");
  expect(store.getState()["models.control_plane_endpoint"]).toBe("mock://control-plane");
});
