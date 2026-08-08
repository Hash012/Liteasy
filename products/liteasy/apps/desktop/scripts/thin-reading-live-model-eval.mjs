import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecretEnvFile } from "../../../../../development/dev-cloud/config.mjs";
import { findAvailablePort } from "./devPorts.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repositoryRoot = resolve(desktopDir, "../../../..");
loadSecretEnvFile();
const provider = process.env.LITEASY_THIN_READING_LIVE_PROVIDER ?? "openai";

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
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be configured in development/dev-cloud/.env.local");
  }
  env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
  }
  env.VITE_LITEASY_OPENAI_MODEL = process.env.VITE_LITEASY_OPENAI_MODEL ?? "gpt-5.4-mini";
}
console.log(`Starting thin-reading live eval (provider=${provider}, case=${process.env.LITEASY_THIN_READING_LIVE_EVAL_CASE ?? "colbert"}).`);
const cloud = spawn(process.execPath, [resolve(repositoryRoot, "development/dev-cloud/server.mjs")], {
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
  console.log("Waiting for the local dev cloud health check.");
  await waitForHealth(endpoint);
  console.log("Dev cloud is ready; starting Vitest with a 120-second live-test timeout.");
  // Run Vitest through this Node executable. Spawning the generated `vitest.cmd`
  // shim directly fails with EINVAL on current Windows Node releases.
  const vitestBinary = resolve(desktopDir, "node_modules", "vitest", "vitest.mjs");
  evaluator = spawn(
    process.execPath,
    [vitestBinary, "run", "src/tests/thinReadingLiveModelEval.test.ts", "--reporter=verbose", "--testTimeout=120000"],
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
  } else {
    console.error(`Thin-reading live model eval failed with exit code ${exitCode}.`);
  }
  process.exitCode = exitCode;
} finally {
  stopCloud();
  await waitForExit(cloud);
}
