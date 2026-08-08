import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const endpoint = process.env.LITEASY_TAURI_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const evidenceDirectory = path.resolve(
  process.env.LITEASY_ACCEPTANCE_EVIDENCE_DIR ??
    path.join(os.tmpdir(), `liteasy-watcher-overflow-${Date.now()}`)
);
const burstSize = Number(process.env.LITEASY_WATCHER_BURST_SIZE ?? "75000");
assert.ok(Number.isSafeInteger(burstSize) && burstSize >= 1000 && burstSize <= 250000);
fs.mkdirSync(evidenceDirectory, { recursive: true });

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap((context) => context.pages())[0];
if (!page) throw new Error("No WebView2 page is attached to the Tauri process.");

const invoke = (command, args = {}) => page.evaluate(
  ({ args: invocationArgs, command: invocationCommand }) =>
    window.__TAURI_INTERNALS__.invoke(invocationCommand, invocationArgs),
  { args, command }
);

async function waitFor(predicate, message, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await page.evaluate(() => window.__liteasyWatcherAcceptanceEvents);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message}: ${JSON.stringify(
    await page.evaluate(() => window.__liteasyWatcherAcceptanceEvents)
  )}`);
}

const initial = await invoke("load_local_library_snapshot");
const root = initial.rootPath.replace(/^\\\\\?\\/, "");
const markerPath = path.join(root, "overflow-recovery-marker.pdf");
fs.writeFileSync(markerPath, "%PDF-1.7\noverflow recovery marker\n");

await page.evaluate(async () => {
  const internals = window.__TAURI_INTERNALS__;
  window.__liteasyWatcherAcceptanceEvents = { changed: [], errors: [] };
  const register = async (event, target) => {
    const handler = internals.transformCallback((payload) => {
      window.__liteasyWatcherAcceptanceEvents[target].push(payload);
    });
    await internals.invoke("plugin:event|listen", {
      event,
      handler,
      target: { kind: "Any" }
    });
  };
  await register("local-library-watch-error", "errors");
  await register("local-library-changed", "changed");
});

const burstDirectory = path.join(root, "watcher-overflow-burst");
fs.mkdirSync(burstDirectory, { recursive: true });
const burstStartedAt = Date.now();
for (let index = 0; index < burstSize; index += 1) {
  const descriptor = fs.openSync(path.join(burstDirectory, `event-${index}.tmp`), "w");
  fs.closeSync(descriptor);
}
const burstDurationMs = Date.now() - burstStartedAt;

const events = await waitFor(
  (value) => value.errors.length > 0 &&
    value.changed.some((event) => event.payload?.fullRescan === true),
  "The Windows watcher did not report overflow and complete a full rescan"
);
const recovered = await invoke("load_local_library_snapshot");
assert.equal(
  recovered.entries.some((entry) => entry.path?.endsWith("overflow-recovery-marker.pdf")),
  true,
  "The full rescan did not preserve the real PDF marker"
);

const result = {
  burstDurationMs,
  burstSize,
  case: "watcherOverflowRecovery",
  changedEventCount: events.changed.length,
  errorEventCount: events.errors.length,
  finishedAt: new Date().toISOString(),
  fullRescanObserved: true,
  passed: true,
  platform: process.platform,
  release: os.release()
};
fs.writeFileSync(
  path.join(evidenceDirectory, "watcher-overflow-acceptance.json"),
  `${JSON.stringify(result, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify({ evidenceDirectory, result }, null, 2)}\n`);
process.exit(0);
