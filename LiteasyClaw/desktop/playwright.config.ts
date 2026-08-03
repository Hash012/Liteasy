import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./src/tests/browser",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:1425",
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
      : {}),
    screenshot: "only-on-failure"
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npx vite --host 127.0.0.1 --port 1425",
        url: "http://127.0.0.1:1425",
        reuseExistingServer: true
      }
});
