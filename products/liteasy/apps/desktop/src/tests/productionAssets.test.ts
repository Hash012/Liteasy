import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { verifyProductionAssets } from "../../scripts/verify-production-assets.mjs";

const directories: string[] = [];
const env = {
  VITE_LITEASY_CLOUD_URL: "https://api.example.test",
  VITE_FORUM_API_URL: "https://forum-api.example.test",
  VITE_FORUM_WEB_URL: "https://forum.example.test"
};

function createAssets(content: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "liteasy-production-assets-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "index.js"), content);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("allows local builds without release endpoint configuration", () => {
  expect(verifyProductionAssets(createAssets("local assets"), { env: {} }).verified).toBe(true);
});

test("accepts installer assets containing all configured service endpoints", () => {
  expect(verifyProductionAssets(createAssets(JSON.stringify(env)), {
    requireReleaseEndpoints: true,
    env
  }).verified).toBe(true);
});

test("rejects installer builds without release endpoint configuration", () => {
  expect(() => verifyProductionAssets(createAssets("local assets"), {
    requireReleaseEndpoints: true,
    env: {}
  })).toThrow(/VITE_LITEASY_CLOUD_URL is required for installer builds/);
});

test.each(Object.keys(env))("rejects assets built without %s", (missingName) => {
  const bundledEndpoints = Object.fromEntries(Object.entries(env).filter(([name]) => name !== missingName));
  expect(() => verifyProductionAssets(createAssets(JSON.stringify(bundledEndpoints)), {
    requireReleaseEndpoints: true,
    env
  })).toThrow(`${missingName} is missing from production assets`);
});

test("keeps the existing production content boundary enabled for installer builds", () => {
  expect(() => verifyProductionAssets(createAssets(`${JSON.stringify(env)}; mockProvider`), {
    requireReleaseEndpoints: true,
    env
  })).toThrow(/removed mock provider/);
});
