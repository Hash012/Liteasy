import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createLocalClientProfile, localClientEnvironment } from "../../scripts/localClientProfile.mjs";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); roots.length = 0; });
test("creates an isolated profile with usable synthetic files and preserves edits on restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "liteasy-profile-space 测试-")); roots.push(root);
  const profile = await createLocalClientProfile(root);
  const config = JSON.parse(await readFile(profile.configPath, "utf8"));
  expect(config.build.beforeDevCommand).toBe("node scripts/dev-local.mjs --frontend");
  expect(config.identifier).toMatch(/^com\.liteasy\.localdev\.p[a-f0-9]{32}$/);
  expect(config.app.security.devCsp).not.toContain("https:");
  expect((await readFile(join(root, "fixtures", "合成读物.epub"))).subarray(0, 2).toString()).toBe("PK");
  await writeFile(join(root, "fixtures", "阅读说明.md"), "User edit");
  expect((await createLocalClientProfile(root)).id).toBe(profile.id);
  expect(await readFile(join(root, "fixtures", "阅读说明.md"), "utf8")).toBe("User edit");
});
test("refuses an existing unmarked directory without overwriting its data", async () => {
  const root = await mkdtemp(join(tmpdir(), "liteasy-unmarked-")); roots.push(root);
  await writeFile(join(root, "notes.md"), "Original");
  await expect(createLocalClientProfile(root)).rejects.toThrow("empty development profile");
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("Original");
});
test("does not forward injected endpoints, API keys or existing profile settings", () => {
  const env = localClientEnvironment({ PATH: "system", VITE_LITEASY_CLOUD_URL: "https://private", OPENAI_API_KEY: "secret", LITEASY_AGENT_SOCKET: "original.sock" }, "/tmp/profile");
  expect(env).toEqual({ PATH: "system", LITEASY_LOCAL_DEV_PROFILE: "/tmp/profile", VITE_LITEASY_LOCAL_ONLY: "1", VITE_LITEASY_DEV_CLOUD_PORT: "" });
});

test("refuses a profile whose writable data directory points outside the profile", async () => {
  const profile = await createLocalClientProfile(); roots.push(profile.root);
  const external = await mkdtemp(join(tmpdir(), "liteasy-external-")); roots.push(external);
  await rm(join(profile.root, "data"), { recursive: true });
  await symlink(external, join(profile.root, "data"), "junction");
  await expect(createLocalClientProfile(profile.root)).rejects.toThrow("symbolic link");
});
