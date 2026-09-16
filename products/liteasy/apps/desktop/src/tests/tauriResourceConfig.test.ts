import fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { verifyTauriResources } from "../../scripts/verify-tauri-resources.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("keeps the tracked Windows icon at the canonical Tauri resource path", () => {
  expect(verifyTauriResources({ requireGitTracked: true })).toEqual({
    checkedResources: 2,
    verified: true,
    windowsIcon: "icons/icon.ico"
  });
});

test("rejects a stale Windows resource icon path before Rust compilation", () => {
  const tauriDirectory = mkdtempSync(path.join(tmpdir(), "liteasy-tauri-resources-"));
  temporaryDirectories.push(tauriDirectory);
  mkdirSync(path.join(tauriDirectory, "icons"));
  fs.copyFileSync(
    path.resolve(process.cwd(), "src-tauri/icons/icon.ico"),
    path.join(tauriDirectory, "icons/icon.ico")
  );
  writeFileSync(path.join(tauriDirectory, "tauri.conf.json"), JSON.stringify({
    bundle: { icon: ["assets/liteasy.ico"] }
  }));

  expect(() => verifyTauriResources({
    configPath: path.join(tauriDirectory, "tauri.conf.json"),
    tauriDirectory
  })).toThrowError(/configured resource does not exist: assets\/liteasy\.ico/);
});

function installerFixture(nsis: Record<string, unknown>) {
  const tauriDirectory = mkdtempSync(path.join(tmpdir(), "liteasy-nsis-resources-"));
  temporaryDirectories.push(tauriDirectory);
  mkdirSync(path.join(tauriDirectory, "icons"));
  fs.copyFileSync(path.resolve("src-tauri/icons/icon.ico"), path.join(tauriDirectory, "icons/icon.ico"));
  const configPath = path.join(tauriDirectory, "tauri.conf.json");
  writeFileSync(configPath, JSON.stringify({ bundle: { icon: ["icons/icon.ico"], windows: { nsis } } }));
  return { configPath, tauriDirectory };
}

test.each(["installerHooks", "template", "headerImage"])("rejects missing NSIS %s before the expensive build", (field) => {
  expect(() => verifyTauriResources(installerFixture({ [field]: "windows/missing.nsh" })))
    .toThrow("configured installer resource does not exist");
});

test("rejects NSIS resource paths outside the checked out Tauri source", () => {
  expect(() => verifyTauriResources(installerFixture({ installerHooks: "../../untracked.nsh" })))
    .toThrow("installer resource must stay inside src-tauri");
});

test("rejects an installer hook available only on the developer's machine", () => {
  const fixture = installerFixture({ installerHooks: "installer-hooks.nsh" });
  writeFileSync(path.join(fixture.tauriDirectory, "installer-hooks.nsh"), "!macro NSIS_HOOK_PREINSTALL\n!macroend\n");
  expect(() => verifyTauriResources({ ...fixture, requireGitTracked: true }))
    .toThrow(/resource is not tracked by Git: [^\n]*installer-hooks\.nsh/);
  expect(verifyTauriResources(fixture).checkedResources).toBe(2);
});
