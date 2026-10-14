import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export function verifyStartupEvidence(evidence) {
  const url = new URL(evidence.url);
  assert.ok(["http:", "https:"].includes(url.protocol) && url.hostname === "tauri.localhost" && !url.port,
    `Expected embedded frontend at tauri.localhost, received ${evidence.url}`);
  assert.equal(evidence.workbenchVisible, true, "The application workbench did not render");
  assert.ok(evidence.moduleScripts > 0 && evidence.styleSheets > 0, "Embedded frontend assets did not load");
  assert.ok(evidence.nativeWindowSize?.width > 0 && evidence.nativeWindowSize?.height > 0, "Native window IPC failed");
}

async function unusedPort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const { port } = server.address();
  await new Promise((accept) => server.close(accept));
  return port;
}

async function verifyInstalledStartup(executable, output) {
  assert.equal(process.platform, "win32", "This check must launch the actual Windows application");
  const { chromium } = await import("@playwright/test");
  await mkdir(output, { recursive: true });
  const port = await unusedPort();
  const endpoint = `http://127.0.0.1:${port}`;
  // The CDP port exists only in this test process environment, never in shipping config.
  const app = spawn(executable, [], {
    cwd: dirname(executable),
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: join(dirname(executable), "smoke-webview-profile") },
    stdio: "ignore",
  });
  let spawnError;
  app.on("error", (error) => { spawnError = error; });
  let browser, page;
  const evidence = { capturedAt: new Date().toISOString(), executable, pageErrors: [] };
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(app.exitCode, null, `Application exited before startup: ${app.exitCode}`);
      try {
        const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) break;
      } catch { /* WebView2 is still starting. */ }
      await delay(250);
    }
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
    evidence.browserVersion = browser.version();
    const context = browser.contexts()[0];
    assert.ok(context, "WebView2 did not create a browser context");
    page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30_000 });
    page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    await page.waitForURL((url) => url.href !== "about:blank", { timeout: 30_000 });
    evidence.url = page.url();
    // Check the origin before waiting for React so a devUrl/error page fails clearly.
    assert.ok(/^https?:\/\/tauri\.localhost(?:\/|$)/.test(evidence.url), `Unexpected startup URL: ${evidence.url}`);
    await page.getByTestId("workbench-layout").waitFor({ state: "visible", timeout: 60_000 });
    Object.assign(evidence, await page.evaluate(async () => ({
      url: location.href,
      workbenchVisible: !!document.querySelector('[data-testid="workbench-layout"]')?.getClientRects().length,
      moduleScripts: document.querySelectorAll('script[type="module"][src]').length,
      styleSheets: document.styleSheets.length,
      nativeWindowSize: await Promise.race([
        window.__TAURI_INTERNALS__.invoke("plugin:window|inner_size", { label: "main" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Native IPC timed out")), 10_000)),
      ]),
    })));
    verifyStartupEvidence(evidence);
    await page.screenshot({ path: join(output, "installed-startup.png") });
    evidence.passed = true;
  } catch (error) {
    evidence.passed = false;
    evidence.error = String(error);
    if (page) {
      evidence.url = page.url();
      await page.screenshot({ path: join(output, "startup-failure.png"), timeout: 5000 }).catch(() => {});
    }
    throw error;
  } finally {
    await writeFile(join(output, "startup.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await browser?.close().catch(() => {});
    if (app.pid && app.exitCode === null) {
      await new Promise((accept) => {
        const stop = spawn("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
        stop.once("exit", accept); stop.once("error", accept);
      });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [executable, output] = process.argv.slice(2);
  assert.ok(executable && output, "Usage: node verify-windows-startup.mjs <installed.exe> <output-directory>");
  await verifyInstalledStartup(resolve(executable), resolve(output));
}
