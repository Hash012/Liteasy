import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // Do not inherit .env.local endpoints or secrets in the isolated profile.
  envDir: mode === "local-only" ? process.env.LITEASY_LOCAL_DEV_PROFILE : undefined,
  plugins: [react()],
  server: { fs: { allow: [dirname(realpathSync(fileURLToPath(new URL("./node_modules/vite", import.meta.url)))), fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../../packages/research-skills", import.meta.url))] } },
  build: { rollupOptions: { input: { app: "index.html", "document-export-cli": "document-export-cli.html", "document-export-diagram": "document-export-diagram.html", "research-demo": "research-demo.html" } } },
  test: {
    environment: "jsdom",
    // Keep unit tests deterministic even when a developer's browser preview selects
    // a real local model endpoint in .env.local.
    env: {
      VITE_LITEASY_DEV_CLOUD_PORT: "",
      VITE_LITEASY_OPENAI_MODEL: ""
    },
    exclude: [...configDefaults.exclude, "src/tests/browser/**"],
    globals: true,
    // Match the successful Windows CI budget for jsdom interactions and cold
    // renderer imports, including when running the same suite locally in WSL.
    testTimeout: 120_000,
    // jsdom and renderer imports are memory/CPU intensive; excessive parallelism
    // makes dialog transitions and release-gate imports miss their test deadlines.
    maxWorkers: 2,
    setupFiles: "./src/tests/setup.ts"
  }
}));
