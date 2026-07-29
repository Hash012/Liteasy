import { spawn } from "node:child_process";
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const testApiPath = resolve(scriptDir, "../../../project-docs/test-api.md");

function readField(content, field) {
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${field}:`));
  return line?.slice(line.indexOf(":") + 1).trim() ?? "";
}

if (!fs.existsSync(testApiPath)) {
  throw new Error(`Missing test API configuration: ${testApiPath}`);
}

const content = fs.readFileSync(testApiPath, "utf8");
const apiKey = readField(content, "OPENAI_KEY");
const apiEndpoint = readField(content, "API_END_POINT");
if (!apiKey || !apiEndpoint) {
  throw new Error("test-api.md must provide OPENAI_KEY and API_END_POINT");
}

const child = spawn(process.execPath, [resolve(scriptDir, "dev-with-cloud.mjs")], {
  cwd: resolve(scriptDir, ".."),
  env: {
    ...process.env,
    OPENAI_API_KEY: apiKey,
    OPENAI_BASE_URL: apiEndpoint,
    VITE_LITEASY_OPENAI_MODEL:
      process.env.VITE_LITEASY_OPENAI_MODEL ?? "gpt-5.4-mini"
  },
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 0;
});
