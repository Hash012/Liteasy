import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { verifyTauriResources } from "../../scripts/verify-tauri-resources.mjs";

const read = (name: string) => JSON.parse(fs.readFileSync(path.resolve("src-tauri", name), "utf8"));

test("keeps the Windows installer and shared identity while selecting native candidate bundles", () => {
  const base = read("tauri.conf.json");
  expect(base.bundle.targets).toEqual(["nsis"]);
  expect(base.bundle.windows.nsis.installerHooks).toBe("windows/installer-hooks.nsh");
  for (const [platform, targets, icon] of [
    ["linux", ["deb"], "icons/128x128.png"],
    ["macos", ["app", "dmg"], "icons/icon.icns"]
  ] as const) {
    const override = read(`tauri.${platform}.conf.json`);
    expect(Object.keys(override).sort()).toEqual(["$schema", "bundle"]);
    expect(override.bundle.targets).toEqual(targets);
    expect(override.bundle.icon).toEqual([icon]);
    // Platform merge must not fork identity, endpoints, permissions or a second UI.
    expect(override.version ?? base.version).toBe(base.version);
    expect(override.identifier ?? base.identifier).toBe(base.identifier);
  }
});

test("validates native platform icons with the same resource gate as Windows", () => {
  expect(verifyTauriResources().checkedResources).toBe(7);
});
