import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const desktop = read("../workflows/desktop-ci.yml");
const frontend = read("../workflows/desktop-frontend.yml");
const windows = read("../workflows/desktop-windows.yml");
const manual = read("../workflows/windows-installer.yml");
const setup = read("../actions/setup-desktop/action.yml");

// actionlint validates YAML syntax and Actions expressions separately. These
// dependency-free checks inspect mapping blocks to protect CI's cost and trust
// boundaries; they can run before npm ci on a fresh checkout.
function block(text, name, indentation) {
  const lines = text.split(/\r?\n/);
  const header = `${" ".repeat(indentation)}${name}:`;
  const start = lines.findIndex((line) => line.trimEnd() === header);
  assert.notEqual(start, -1, `Missing YAML mapping: ${name}`);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && !line.trimStart().startsWith("#") && line.search(/\S/) <= indentation) break;
    end += 1;
  }
  return lines.slice(start + 1, end).join("\n");
}

function value(text, name, indentation) {
  const prefix = `${" ".repeat(indentation)}${name}:`;
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

function job(text, name) {
  return block(block(text, "jobs", 0), name, 2);
}

function steps(text, name) {
  const content = block(job(text, name), "steps", 4);
  return content.split(/^      - /m).slice(1).map((step) => `      - ${step}`);
}

function expression(input) {
  return input?.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
}

function list(input) {
  assert.match(input ?? "", /^\[.*\]$/);
  return input.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, ""));
}

function findStep(text, name, command) {
  const matched = steps(text, name).filter((step) => step.includes(command));
  assert.equal(matched.length, 1, `Expected one step containing ${command}`);
  return matched[0];
}

test("ordinary pushes and PR changes reach policy without opting into installers by default", () => {
  const events = block(desktop, "on", 0);
  assert.deepEqual(list(value(block(events, "push", 2), "branches", 4)), ["**"]);
  assert.equal(value(block(events, "push", 2), "tags", 4), undefined);
  const prEvents = list(value(block(events, "pull_request", 2), "types", 4));
  for (const event of ["opened", "synchronize", "reopened", "edited", "labeled", "unlabeled"]) {
    assert.ok(prEvents.includes(event), `PR ${event} must re-evaluate installer markers`);
  }
  assert.match(events, /^  merge_group:/m);
  const dispatch = block(block(block(events, "workflow_dispatch", 2), "inputs", 4), "build-installer", 6);
  assert.equal(value(dispatch, "type", 8), "boolean");
  assert.equal(value(dispatch, "default", 8), "false");
  assert.match(job(desktop, "policy"), /run: node \.github\/scripts\/installer-policy\.mjs/);
});

test("the policy selects both full tests and installer packaging for the same revision", () => {
  const frontendCall = job(desktop, "frontend");
  const windowsCall = job(desktop, "windows");
  assert.equal(value(frontendCall, "needs", 4), "policy");
  assert.deepEqual(list(value(windowsCall, "needs", 4)), ["policy", "frontend"]);
  assert.equal(value(frontendCall, "uses", 4), "./.github/workflows/desktop-frontend.yml");
  assert.equal(value(windowsCall, "uses", 4), "./.github/workflows/desktop-windows.yml");
  for (const [call, input] of [[frontendCall, "full-tests"], [windowsCall, "build-installer"]]) {
    assert.equal(expression(value(block(call, "with", 4), input, 6)), "needs.policy.outputs.build-installer == 'true'");
    assert.equal(value(call, "if", 4), undefined, "A requested layer must not silently skip");
  }
});

test("basic frontend checks always run but complete test shards require opt-in", () => {
  for (const command of ["npm run ci:contracts", "npm run ci:smoke"]) {
    const step = findStep(frontend, "contracts", command);
    assert.equal(value(step, "if", 8), undefined);
  }
  const testJob = job(frontend, "tests");
  assert.equal(expression(value(testJob, "if", 4)), "inputs.full-tests");
  assert.equal(value(testJob, "needs", 4), "contracts");
  assert.match(testJob, /shard: \[1, 2\]/);
  assert.match(testJob, /npm test -- --shard=\$\{\{ matrix\.shard \}\}\/2/);
  const options = block(block(block(frontend, "on", 0), "workflow_call", 2), "inputs", 4);
  assert.equal(value(block(options, "full-tests", 6), "default", 8), "false");
});

test("ordinary Windows checks avoid production build, test execution, Release linking and NSIS", () => {
  const check = findStep(windows, "windows", "cargo check");
  assert.equal(expression(value(check, "if", 8)), "!inputs.build-installer");
  assert.match(check, /cargo check --locked --all-targets --no-default-features --manifest-path src-tauri\/Cargo\.toml/);
  for (const command of [
    "run: npm run build",
    "cargo test --locked",
    "tauri -- build --no-bundle -- --locked",
    "tauri -- bundle --bundles nsis",
    "Get-FileHash",
    "actions/upload-artifact@",
  ]) {
    const step = findStep(windows, "windows", command);
    assert.equal(expression(value(step, "if", 8)), "inputs.build-installer", command);
  }
  const productionSteps = steps(windows, "windows").filter((step) => step.includes("verify:production-assets"));
  assert.equal(productionSteps.length, 2);
  for (const step of productionSteps) assert.equal(expression(value(step, "if", 8)), "inputs.build-installer");
  const options = block(block(block(windows, "on", 0), "workflow_call", 2), "inputs", 4);
  assert.equal(value(block(options, "build-installer", 6), "default", 8), "false");
});

test("development compilation has a real dev URL and keeps production features for installers", () => {
  const config = JSON.parse(read("../../products/liteasy/apps/desktop/src-tauri/tauri.conf.json"));
  assert.equal(new URL(config.build.devUrl).protocol, "http:");
  assert.equal(config.build.frontendDist, "../dist");
  const manifest = read("../../products/liteasy/apps/desktop/src-tauri/Cargo.toml");
  assert.match(manifest, /^default = \["custom-protocol"\]$/m);
  assert.match(manifest, /^custom-protocol = \["tauri\/custom-protocol"\]$/m);
  assert.doesNotMatch(windows, /(?:mkdir|New-Item|writeFile|Set-Content)[^\n]*\bdist\b/i);
});

test("the manual installer reuses both full validation layers without bypassing tests", () => {
  assert.match(block(manual, "on", 0), /^  workflow_dispatch:/m);
  assert.doesNotMatch(block(manual, "on", 0), /^  (?:push|pull_request):/m);
  const tests = job(manual, "test-desktop");
  const build = job(manual, "build-windows");
  assert.equal(value(tests, "uses", 4), value(job(desktop, "frontend"), "uses", 4));
  assert.equal(value(build, "uses", 4), value(job(desktop, "windows"), "uses", 4));
  assert.equal(value(block(tests, "with", 4), "full-tests", 6), "true");
  assert.equal(value(block(build, "with", 4), "build-installer", 6), "true");
  assert.equal(value(build, "needs", 4), "test-desktop");
});

test("the ready gate receives every requested layer even after failures or cancellations", () => {
  const gate = job(desktop, "ready");
  assert.equal(expression(value(gate, "if", 4)), "always()");
  assert.deepEqual(list(value(gate, "needs", 4)), ["policy", "frontend", "windows"]);
  const step = findStep(desktop, "ready", "node .github/scripts/require-ci-success.mjs");
  const env = block(step, "env", 8);
  assert.equal(expression(value(env, "CI_RESULTS", 10)), "toJSON(needs)");
  assert.equal(expression(value(env, "BUILD_INSTALLER", 10)), "needs.policy.outputs.build-installer");
});

test("shared setup installs the lockfile and workflows keep untrusted event text out of shell code", () => {
  assert.match(setup, /node-version-file: products\/liteasy\/apps\/desktop\/\.nvmrc/);
  assert.match(setup, /run: npm ci --no-audit --no-fund/);
  for (const workflow of [desktop, frontend, windows, manual]) {
    assert.equal(value(block(workflow, "permissions", 0), "contents", 2), "read");
    assert.doesNotMatch(workflow, /pull_request_target|secrets: inherit|continue-on-error/);
    assert.doesNotMatch(workflow, /\$\{\{[^\n}]*(?:\.title|\.body|\.message|\.labels)[^\n}]*\}\}/);
    for (const match of workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)) {
      assert.ok(match[1].startsWith("./") || /@[a-f0-9]{40}$/.test(match[1]), `Action must use a fixed commit: ${match[1]}`);
    }
  }
});
