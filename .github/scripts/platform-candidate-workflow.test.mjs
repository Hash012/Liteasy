import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { candidateMatrix, readRustToolchain } from "./platform-candidate.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const workflow = read("../workflows/desktop-platform-candidates.yml");

function mapping(text, name, indent) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `${" ".repeat(indent)}${name}:`);
  assert.notEqual(start, -1, `Missing mapping: ${name}`);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].trimStart().startsWith("#") || lines[end].search(/\S/) > indent)) end += 1;
  return lines.slice(start + 1, end).join("\n");
}

const jobs = mapping(workflow, "jobs", 0);
const candidate = mapping(jobs, "candidate", 2);

test("platform packaging requires explicit dispatch and cannot publish or alter Windows depth", () => {
  const events = mapping(workflow, "on", 0);
  assert.match(events, /^  workflow_dispatch:/m);
  assert.doesNotMatch(events, /^  (?:push|pull_request|pull_request_target|workflow_run|schedule):/m);
  for (const id of candidateMatrix("both").map((item) => item.id)) assert.ok(events.includes(`- ${id}`));
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /continue-on-error|secrets:|gh release|publish|desktop-windows\.yml|build-installer:/);
  assert.doesNotMatch(workflow, /products\/(?:intuecho|marketing)|development\/dev-cloud|platform\/identity-service|services\/api/);
  for (const match of workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)) {
    assert.ok(match[1].startsWith("./") || /@[a-f0-9]{40}$/.test(match[1]), `Unpinned action: ${match[1]}`);
  }
});

test("native candidates reuse frontend validation and setup with default-feature locked production builds", () => {
  const frontend = mapping(jobs, "frontend", 2);
  assert.match(frontend, /uses: \.\/\.github\/workflows\/desktop-frontend\.yml/);
  assert.match(frontend, /full-tests: true/);
  assert.match(candidate, /needs: \[select, frontend\]/);
  assert.match(candidate, /uses: \.\/\.github\/actions\/setup-desktop/);
  assert.match(candidate, /toolchain: \$\{\{ needs\.select\.outputs\.rust \}\}/);
  assert.match(readRustToolchain(read("../workflows/desktop-windows.yml")), /^\d+\.\d+\.\d+$/);
  const commands = [
    "platform-candidate.mjs host",
    "npm run build",
    'cargo test --locked --target "$CANDIDATE_TARGET"',
    'npm run tauri -- build --target "$CANDIDATE_TARGET" --no-bundle -- --locked',
    'npm run tauri -- bundle --target "$CANDIDATE_TARGET" --bundles "$CANDIDATE_BUNDLES"',
    "platform-candidate.mjs inspect",
    "check-clean.mjs package-lock.json src-tauri/Cargo.lock ../../packages/shared",
  ];
  const offsets = commands.map((command) => {
    const index = candidate.indexOf(command);
    assert.notEqual(index, -1, command);
    return index;
  });
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
  assert.doesNotMatch(candidate, /--no-default-features|mkdir[^\n]*\bdist\b|--ignore|--skip/);
});

test("native dependencies use segregated optional caches and no native node_modules cache", () => {
  const inputs = mapping(mapping(mapping(workflow, "on", 0), "workflow_dispatch", 2), "inputs", 4);
  assert.match(mapping(inputs, "use-rust-cache", 6), /default: false/);
  assert.match(candidate, /if: \$\{\{ inputs\.use-rust-cache \}\}/);
  const key = candidate.split("\n").find((line) => line.includes("shared-key:"));
  for (const field of ["runner.os", "runner.arch", "matrix.target", "needs.select.outputs.rust", "test-release-default", "Cargo.lock", "package-lock.json"]) assert.ok(key.includes(field), field);
  assert.doesNotMatch(candidate, /path: .*node_modules/);
  assert.match(candidate, /cache-workspace-crates: false/);
});

test("outcomes and artifact evidence survive failures and skipped required jobs fail the aggregate", () => {
  assert.match(candidate, /name: Record actual outcomes and checksums\n        if: \$\{\{ always\(\) \}\}/);
  assert.match(candidate, /CANDIDATE_STEPS: \$\{\{ toJSON\(steps\) \}\}/);
  assert.match(candidate, /name: Upload candidate artifacts and evidence\n        if: \$\{\{ always\(\) \}\}/);
  assert.match(candidate, /if-no-files-found: error/);
  const ready = mapping(jobs, "ready", 2);
  assert.match(ready, /if: \$\{\{ always\(\) \}\}/);
  assert.match(ready, /needs: \[select, frontend, candidate\]/);
  assert.match(ready, /CI_RESULTS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(ready, /platform-candidate.mjs require-success/);
});
