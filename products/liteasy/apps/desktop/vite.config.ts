import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const fileWorkflowTestRoute = "/file-workflow-test/larimar-episodic-memory.pdf";
const fileWorkflowTestPdf = resolve(
  __dirname,
  "../../../../development/test-data/file-workflow-test/larimar-episodic-memory.pdf"
);

function fileWorkflowTestPdfPlugin(): Plugin {
  return {
    apply: "serve" as const,
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?", 1)[0] !== fileWorkflowTestRoute) {
          next();
          return;
        }
        try {
          const bytes = await readFile(fileWorkflowTestPdf);
          response.statusCode = 200;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Length", String(bytes.byteLength));
          response.setHeader("Content-Type", "application/pdf");
          response.end(bytes);
        } catch (error) {
          next(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    name: "file-workflow-test-pdf"
  };
}

export default defineConfig({
  plugins: [react(), fileWorkflowTestPdfPlugin()],
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
    setupFiles: "./src/tests/setup.ts"
  }
});
