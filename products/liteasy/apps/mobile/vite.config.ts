import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const assetRoot = new URL("./node_modules/.liteasy-mobile-assets/", import.meta.url);
mkdirSync(new URL("pdf-assets/", assetRoot), { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(new URL(`./node_modules/pdfjs-dist/${folder}`, import.meta.url), new URL(`pdf-assets/${folder}`, assetRoot), { recursive: true });
}

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(assetRoot),
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: "0.0.0.0" },
  test: { environment: "jsdom", setupFiles: ["./src/tests/setup.ts"], maxWorkers: 2, include: ["src/tests/**/*.test.{ts,tsx}"] },
  build: { target: "es2022" }
});
