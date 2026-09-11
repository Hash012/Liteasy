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
    checkedResources: 1,
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
