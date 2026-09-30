import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: "0.0.0.0" },
  test: { environment: "jsdom", setupFiles: ["./src/tests/setup.ts"], maxWorkers: 2 },
  build: { target: "es2022" }
});
