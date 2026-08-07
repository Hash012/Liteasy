import { createSettingsStore } from "../app/features/settings/settings.store";

test("stores cloud-governed model access policy defaults", () => {
  const store = createSettingsStore();

  expect(store.getState()["models.default_provider"]).toBe("openai");
  expect(store.getState()["models.cloud_proxy_endpoint"]).toBe("http://127.0.0.1:8787");
  expect(store.getState()["models.control_plane_endpoint"]).toBe("http://127.0.0.1:8787");
});
