import { spawn } from "node:child_process";
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findAvailablePort } from "./devPorts.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..");
const testApiPath = resolve(scriptDir, "../../../project-docs/test-api.md");
const provider = process.env.LITEASY_THIN_READING_LIVE_PROVIDER ?? "openai";

function readField(content, field) {
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${field}:`));
  return line?.slice(line.indexOf(":") + 1).trim() ?? "";
}

function waitForHealth(endpoint, timeoutMs = 20_000) {
  const startedAt = Date.now();
  return new Promise((resolveHealth, rejectHealth) => {
    const poll = async () => {
      try {
        const response = await fetch(`${endpoint}/healthz`);
        if (response.ok) {
          resolveHealth();
          return;
        }
      } catch {
        // The child can take a moment to bind its local port.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        rejectHealth(new Error("Timed out waiting for the local live-model dev cloud."));
        return;
      }
      setTimeout(poll, 200);
    };
    void poll();
  });
}

if (provider !== "openai" && provider !== "deepseek") {
  throw new Error(`Unsupported live thin-reading provider: ${provider}`);
}

const host = "127.0.0.1";
const port = await findAvailablePort(8787, host);
const endpoint = `http://${host}:${port}`;
const env = {
  ...process.env,
  LITEASY_DEV_CLOUD_HOST: host,
  LITEASY_DEV_CLOUD_PORT: String(port),
  LITEASY_MODEL_PROVIDER: provider
};
if (provider === "openai") {
  if (!fs.existsSync(testApiPath)) {
    throw new Error(`Missing test API configuration: ${testApiPath}`);
  }
  const content = fs.readFileSync(testApiPath, "utf8");
  const apiKey = readField(content, "OPENAI_KEY");
  const apiEndpoint = readField(content, "API_END_POINT");
  if (!apiKey || !apiEndpoint) {
    throw new Error("test-api.md must provide OPENAI_KEY and API_END_POINT");
  }
  env.OPENAI_API_KEY = apiKey;
  env.OPENAI_BASE_URL = apiEndpoint;
  env.VITE_LITEASY_OPENAI_MODEL = process.env.VITE_LITEASY_OPENAI_MODEL ?? "gpt-5.4-mini";
}
const cloud = spawn(process.execPath, [resolve(repoRoot, "services/dev-cloud/server.mjs")], {
  cwd: desktopDir,
  env,
  stdio: "inherit"
});

let shuttingDown = false;
let evaluator;
function stopCloud() {
  if (!shuttingDown && !cloud.killed) {
    shuttingDown = true;
    cloud.kill("SIGTERM");
  }
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }
    child.once("exit", () => resolveExit());
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (evaluator && !evaluator.killed) {
      evaluator.kill(signal);
    }
    stopCloud();
    process.exitCode = 1;
  });
}

try {
  await waitForHealth(endpoint);
  const vitestBinary = resolve(
    desktopDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest"
  );
  evaluator = spawn(
    vitestBinary,
    ["run", "src/tests/thinReadingLiveModelEval.test.ts"],
    {
      cwd: desktopDir,
      env: {
        ...env,
        LITEASY_THIN_READING_LIVE_EVAL_CASE: process.env.LITEASY_THIN_READING_LIVE_EVAL_CASE,
        LITEASY_THIN_READING_LIVE_EVAL_ENDPOINT: endpoint,
        LITEASY_THIN_READING_LIVE_EVAL_PROVIDER: provider
      },
      stdio: "inherit"
    }
  );
  const exitCode = await new Promise((resolveExit) => {
    evaluator.once("error", (error) => {
      console.error(`Unable to start the live-model evaluator: ${error.message}`);
      resolveExit(1);
    });
    evaluator.on("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode === 0) {
    console.log("Thin-reading live model eval passed through the desktop generation path.");
  }
  process.exitCode = exitCode;
} finally {
  stopCloud();
  await waitForExit(cloud);
}
