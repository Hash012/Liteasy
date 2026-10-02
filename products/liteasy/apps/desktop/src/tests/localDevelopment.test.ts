import { afterEach, expect, test, vi } from "vitest";
import { initializeLocalDevelopment } from "../app/features/workbench/localDevelopment";
import { shouldApplyLocalDevCloudDefaults } from "../app/features/models/localDevCloudEndpoint";
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
test("local development refuses production/cloud fetches while keeping local assets usable", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("local"));
  vi.stubGlobal("fetch", fetch);
  initializeLocalDevelopment();
  await expect(globalThis.fetch("https://api.example.test/v1/papers")).rejects.toThrow("local_development_network_disabled");
  await globalThis.fetch("/local-fixture.md");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem("liteasy.local-literature.v1")!)["papers.local_mode"]).toBe(true);
  expect(shouldApplyLocalDevCloudDefaults({ hostname: "127.0.0.1", protocol: "http:", port: "1420" }, { VITE_LITEASY_LOCAL_ONLY: "1", VITE_LITEASY_DEV_CLOUD_PORT: "8787" })).toBe(false);
});
