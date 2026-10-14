import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyStartupEvidence } from "../../products/liteasy/apps/desktop/scripts/verify-windows-startup.mjs";

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
