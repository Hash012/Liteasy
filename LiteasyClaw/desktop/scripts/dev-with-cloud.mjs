import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadSecretEnvFile } from "../../services/dev-cloud/config.mjs";
import {
  buildChildEnv,
  buildDesktopViteArgs,
  findAvailablePort,
  resolveRequestedCloudHost,
  resolveRequestedCloudPort,
  resolveRequestedDesktopHost,
  resolveRequestedDesktopPort
} from "./devPorts.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..");
loadSecretEnvFile();
const cloudHost = resolveRequestedCloudHost();
const requestedCloudPort = resolveRequestedCloudPort();
const cloudPort = await findAvailablePort(requestedCloudPort, cloudHost);
const desktopHost = resolveRequestedDesktopHost();
const desktopPort = resolveRequestedDesktopPort();
const childEnv = buildChildEnv({
  host: cloudHost,
  port: cloudPort
});

if (cloudPort !== requestedCloudPort) {
  console.log(
    `[dev] Liteasy dev cloud port ${requestedCloudPort} is busy; using ${cloudPort} for this session.`
  );
}

const processes = [
  {
    args: [resolve(repoRoot, "services/dev-cloud/server.mjs")],
    command: process.execPath,
    name: "dev:cloud"
  },
  {
    // Run Vite's own JS entry with this Node binary, the same way the dev cloud is started
    // above. Going through `npx` meant spawning `npx.cmd` on Windows, which current Node
    // refuses without a shell — `spawn EINVAL` — so `tauri dev` could never boot there.
    args: [
      resolve(desktopDir, "node_modules/vite/bin/vite.js"),
      ...buildDesktopViteArgs({ host: desktopHost, port: desktopPort }).filter(
        (argument) => argument !== "vite"
      )
    ],
    command: process.execPath,
    name: "dev:desktop"
  }
];

const children = processes.map((entry) => {
  const child = spawn(entry.command, entry.args, {
    cwd: desktopDir,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${entry.name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${entry.name}] ${chunk}`);
  });

  return child;
});

function shutdown(signal) {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

children.forEach((child) => {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exitCode = code;
    }
  });
});
