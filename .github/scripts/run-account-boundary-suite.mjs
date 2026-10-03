import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktop = "products/liteasy/apps/desktop";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const npm = (cwd, ...args) => ({ cwd, executable: "npm", args });
const node = (file) => ({ cwd: ".", executable: process.execPath, args: [file] });

export function accountCommands(suite, files = []) {
  if (suite === "services-unit") return [
    npm("platform/identity-service", "test"), npm("products/liteasy/services/api", "test"),
    npm("products/intuecho", "test"), npm("products/intuecho", "run", "build")
  ];
  if (suite === "services-postgres") return [
    node("products/liteasy/services/api/scripts/verify-postgres-integration.mjs"),
    node("products/intuecho/services/api/scripts/verify-postgres-integration.mjs"),
    node("products/intuecho/services/api/scripts/verify-thin-reading-withdrawal.mjs"),
    node("products/intuecho/services/api/scripts/verify-desktop-publication-profile.mjs")
  ];
  if (suite === "desktop") {
    const tests = files.filter((file) => file.startsWith(`${desktop}/src/tests/`) && /\.test\.tsx?$/.test(file)
      && /(?:account|sessionBinding|sessionRuntime|identity|cloud|organization|publication|forum|community|libraryResourceTransfer|source|resourceReference|provenance|spaceOperation|agent|capability|policy|durableWorkflow|extensionStudio|actionRegistry|planExecutor|runtimeOrchestrator|contextBuilder|localAssetMcp)/i.test(path.basename(file)));
    if (!tests.length) throw new Error("Account contract test selection is empty");
    return [npm(desktop, "run", "ci:smoke"), npm(desktop, "run", "ci:contracts"),
      npm(desktop, "test", "--", ...tests.map((file) => path.relative(desktop, file)))];
  }
  if (["admin", "mobile"].includes(suite)) return [npm(`products/liteasy/apps/${suite}`, "test"), npm(`products/liteasy/apps/${suite}`, "run", "build")];
  throw new Error("Unknown account boundary suite");
}

export function runCommands(commands, execute = spawnSync) {
  const results = [];
  for (const command of commands) {
    const child = execute(command.executable, command.args, { cwd: path.join(root, command.cwd), stdio: "inherit", timeout: 15 * 60_000 });
    const exitCode = Number.isInteger(child.status) ? child.status : 1;
    results.push({ cwd: command.cwd, command: [path.basename(command.executable), ...command.args], exitCode, status: exitCode === 0 ? "pass" : "fail" });
    if (exitCode !== 0) break;
  }
  return results;
}

export function evidenceSummary({ suite, commit, tree, dirtyDiffHash, files, results, environment }) {
  // A fixed whitelist: subprocess output, environment values, database URLs,
  // event payloads, PDF text and screenshots never enter downloadable evidence.
  return {
    schema: "liteasy.boundary-evidence/v1", suite, testedCommit: commit, tree, dirtyDiffHash,
    environment: { os: environment.os, architecture: environment.architecture, node: environment.node },
    files: files.map(({ path: file, sha256: digest }) => ({ path: file, sha256: digest })),
    results: results.map(({ cwd, command, exitCode, status }) => ({ cwd, command, exitCode, status })),
    status: results.length && results.every((result) => result.status === "pass") ? "pass" : "fail",
    excluded: ["native-Windows-OAuth-keyring-handoff", "native-Linux-OAuth-keyring-handoff", "native-macOS-OAuth-keyring-handoff", "real-IdP", "real-S3-scanner", "production", "voluntary-human-pilot"].map((layer) => ({ layer, status: "not_run" })),
    redactions: ["no subprocess logs", "no credentials or environment values", "no database dumps", "no user content"]
  };
}

function main() {
  const suite = process.argv[2];
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  const commands = accountCommands(suite, files);
  const before = git("rev-parse", "HEAD");
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: root });
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  const dirty = diff.length || untracked.length ? sha256(Buffer.concat([diff, ...untracked.map((file) => Buffer.concat([Buffer.from(file), readFileSync(path.join(root, file))]))])) : null;
  const inputs = files.filter((file) => /\.(?:mjs|ts|tsx|sql|json|yml|yaml)$/.test(file)
    && /^(?:\.github\/|products\/(?:intuecho|liteasy\/(?:apps|services|packages))\/|platform\/identity-service\/)/.test(file));
  const hashes = inputs.map((file) => ({ path: file, sha256: sha256(readFileSync(path.join(root, file))) }));
  const results = runCommands(commands);
  if (git("rev-parse", "HEAD") !== before) throw new Error("Tested commit changed during verification");
  if (hashes.some((file) => sha256(readFileSync(path.join(root, file.path))) !== file.sha256)) {
    results.push({ cwd: ".", command: ["source-integrity"], exitCode: 1, status: "fail" });
  }
  const summary = evidenceSummary({ suite, commit: before, tree: git("rev-parse", "HEAD^{tree}"), dirtyDiffHash: dirty,
    files: hashes, results, environment: { os: `${os.platform()} ${os.release()}`, architecture: os.arch(), node: process.version } });
  const output = path.join(root, "test-results", "account-boundaries");
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, `${suite}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  if (summary.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
