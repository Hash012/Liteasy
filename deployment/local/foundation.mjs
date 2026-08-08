import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localEnvPath } from "./config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeArguments = [
  "compose",
  "--env-file",
  "deployment/local/.env",
  "--file",
  "deployment/local/compose.yaml"
];

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: repositoryRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function requireEnvironment() {
  if (!fs.existsSync(localEnvPath)) {
    throw new Error("deployment/local/.env is missing; run the prepare command first");
  }
}

const actions = {
  prepare() {
    run(process.execPath, ["deployment/local/prepare.mjs"]);
  },
  start() {
    requireEnvironment();
    run("docker", [...composeArguments, "up", "--detach", "--build", "--wait", "--wait-timeout", "180"]);
  },
  migrate() {
    requireEnvironment();
    run(process.execPath, ["deployment/local/migrate.mjs"]);
  },
  verify() {
    requireEnvironment();
    run(process.execPath, ["deployment/scripts/verify-local-foundation.mjs", "--runtime"]);
    run(process.execPath, ["deployment/local/verify-postgres.mjs"]);
  },
  restart() {
    requireEnvironment();
    run("docker", [...composeArguments, "restart"]);
    run("docker", [...composeArguments, "up", "--detach", "--wait", "--wait-timeout", "180"]);
    actions.verify();
  },
  status() {
    requireEnvironment();
    run("docker", [...composeArguments, "ps", "--all"]);
  },
  stop() {
    requireEnvironment();
    run("docker", [...composeArguments, "down"]);
  }
};

const actionName = process.argv[2];
if (!Object.hasOwn(actions, actionName)) {
  process.stderr.write("Usage: node deployment/local/foundation.mjs <prepare|start|migrate|verify|restart|status|stop>\n");
  process.exit(2);
}

try {
  actions[actionName]();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
