import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyStartupEvidence } from "../../products/liteasy/apps/desktop/scripts/verify-windows-startup.mjs";
import { verifyWindowsPayload } from "../../products/liteasy/apps/desktop/scripts/verify-windows-payload.mjs";

const loaded = {
  url: "http://tauri.localhost/", workbenchVisible: true,
  moduleScripts: 1, styleSheets: 2, nativeWindowSize: { width: 1440, height: 920 },
};

test("an installed frontend must render from the embedded protocol with working native IPC", () => {
  assert.doesNotThrow(() => verifyStartupEvidence(loaded));
  assert.doesNotThrow(() => verifyStartupEvidence({ ...loaded, url: "https://tauri.localhost/index.html" }));
});

test("reject the devUrl binary regression even if a development server happens to render the UI", () => {
  for (const url of ["http://localhost:1420/", "http://127.0.0.1:1420/", "http://tauri.localhost:1420/", "edge-error://edgewebdata/", "about:blank"]) {
    assert.throws(() => verifyStartupEvidence({ ...loaded, url }), /Expected embedded frontend/);
  }
});

test("an installer cannot pass with an empty/error page, missing assets or a broken host bridge", () => {
  for (const missing of [
    { workbenchVisible: false }, { moduleScripts: 0 }, { styleSheets: 0 },
    { nativeWindowSize: undefined }, { nativeWindowSize: { width: 0, height: 0 } },
  ]) {
    assert.throws(() => verifyStartupEvidence({ ...loaded, ...missing }));
  }
});

test("installed payload identity allows exactly Tauri's first NSIS marker replacement", () => {
  const release = Buffer.from("MZ\0frontend\0__TAURI_BUNDLE_TYPE_VAR_UNK\0__TAURI_BUNDLE_TYPE_VAR_UNK\0end");
  const installed = Buffer.from("MZ\0frontend\0__TAURI_BUNDLE_TYPE_VAR_NSS\0__TAURI_BUNDLE_TYPE_VAR_UNK\0end");
  const evidence = verifyWindowsPayload(release, installed);
  assert.notEqual(evidence.releaseSha256, evidence.installedSha256);
  assert.equal(evidence.expectedInstalledSha256, evidence.installedSha256);
  assert.equal(release.toString().includes("_VAR_NSS"), false, "Verification must not mutate the Release bytes");
});

test("payload verification rejects missing frontend bytes and changes outside the bundler marker", () => {
  const release = Buffer.from("MZ\0frontend\0__TAURI_BUNDLE_TYPE_VAR_UNK\0end");
  for (const payload of [
    "MZ\0__TAURI_BUNDLE_TYPE_VAR_NSS\0end",
    "MZ\0modified\0__TAURI_BUNDLE_TYPE_VAR_NSS\0end",
    "MZ\0frontend\0__TAURI_BUNDLE_TYPE_VAR_MSI\0end",
    release.toString(),
  ]) assert.throws(() => verifyWindowsPayload(release, Buffer.from(payload)), /differs from the Release/);
  assert.throws(() => verifyWindowsPayload(Buffer.from("no marker"), Buffer.from("no marker")), /missing the Tauri/);
});
