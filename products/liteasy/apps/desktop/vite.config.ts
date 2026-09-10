import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    // jsdom and renderer imports are memory/CPU intensive; excessive parallelism
    // makes dialog transitions and release-gate imports miss their test deadlines.
    maxWorkers: 2,
    setupFiles: "./src/tests/setup.ts"
  }
});
