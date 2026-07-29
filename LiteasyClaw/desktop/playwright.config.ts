import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/tests/browser",
  use: {
    baseURL: "http://127.0.0.1:1425",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 1425",
    url: "http://127.0.0.1:1425",
    reuseExistingServer: true
  }
});
