import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { verifyProductionAssets } from "./verify-production-assets.mjs";

const releaseEnv = {
  VITE_FORUM_API_URL: "https://community.staging.liteasyclaw.com",
  VITE_FORUM_WEB_URL: "https://community.staging.liteasyclaw.com",
  VITE_LITEASY_CLOUD_URL: "https://api.staging.liteasyclaw.com"
};
const fixtureDirectories = [];

function fixture(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-production-assets-"));
  fs.writeFileSync(path.join(directory, "index.js"), content);
  fixtureDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test("production assets require all release endpoints outside CI", () => {
  const directory = fixture("production");

  expect(() => verifyProductionAssets(directory, {})).toThrow(
    "VITE_LITEASY_CLOUD_URL is required for production builds"
  );
});

test("production assets contain every configured release endpoint", () => {
  const directory = fixture(Object.values(releaseEnv).join("\n"));

  expect(verifyProductionAssets(directory, releaseEnv)).toEqual({
    checkedFiles: 1,
    verified: true
  });
});
