import { createSettingsStore } from "../app/features/settings/settings.store";

test("stores cloud-governed model access policy defaults", () => {
  const store = createSettingsStore();

  expect(store.getState()["models.default_provider"]).toBe("openai");
  expect(store.getState()["models.cloud_proxy_endpoint"]).toBe("mock://cloud-proxy");
  expect(store.getState()["models.control_plane_endpoint"]).toBe("mock://control-plane");
});
