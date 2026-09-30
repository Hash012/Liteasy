import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:1423";
export default defineConfig({
  testDir: "./src/tests/browser", workers: 1, timeout: 45_000,
  use: { baseURL, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, screenshot: "only-on-failure" },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: "npx vite --host 127.0.0.1 --port 1423 --strictPort", url: baseURL, reuseExistingServer: false }
});
