import { createSettingsStore } from "../app/features/settings/settings.store";

test("stores cloud-governed model access policy defaults", () => {
  const store = createSettingsStore();

  expect(store.getState()["models.default_provider"]).toBe("openai");
  expect(store.getState()["models.cloud_proxy_endpoint"]).toBe("http://127.0.0.1:8787");
  expect(store.getState()["models.control_plane_endpoint"]).toBe("http://127.0.0.1:8787");
});

test("uses release HTTPS endpoints injected by the desktop build", () => {
  const store = createSettingsStore({
    VITE_FORUM_API_URL: "https://community.staging.liteasyclaw.com/",
    VITE_LITEASY_CLOUD_URL: "https://api.staging.liteasyclaw.com/"
  });

  expect(store.getState()["models.cloud_proxy_endpoint"]).toBe("https://api.staging.liteasyclaw.com");
  expect(store.getState()["models.control_plane_endpoint"]).toBe("https://api.staging.liteasyclaw.com");
  expect(store.getState()["thin_reading.intuecho_endpoint"]).toBe("https://community.staging.liteasyclaw.com");
});

test("rejects non-HTTPS remote release endpoints", () => {
  expect(() => createSettingsStore({
    VITE_LITEASY_CLOUD_URL: "http://api.staging.liteasyclaw.com"
  })).toThrow("desktop_runtime_endpoint_invalid");
});
