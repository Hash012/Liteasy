/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function copyPdfjsAssets(dir: string) {
  const src = join(process.cwd(), "node_modules/pdfjs-dist", dir);
  const dest = join(process.cwd(), "public", dir);
  if (!existsSync(src)) return;
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    const files = readdirSync(src);
    for (const f of files) {
      copyFileSync(join(src, f), join(dest, f));
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-pdfjs-cmaps",
      buildStart() { copyPdfjsAssets("cmaps"); copyPdfjsAssets("standard_fonts"); },
      configureServer() { copyPdfjsAssets("cmaps"); copyPdfjsAssets("standard_fonts"); },
    },
  ],
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/tests/setup.ts"
  }
});
