import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkClean } from "./check-clean.mjs";

const scriptPath = fileURLToPath(new URL("./check-clean.mjs", import.meta.url));

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "liteasy-check-clean-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--quiet");
  mkdirSync(join(cwd, "generated"));
  mkdirSync(join(cwd, "other"));
  writeFileSync(join(cwd, "package-lock.json"), "original lockfile\n");
  writeFileSync(join(cwd, "generated", "schema.ts"), "original schema\n");
  writeFileSync(join(cwd, "other", "readme.md"), "original docs\n");
  git("add", ".");
  git("-c", "user.name=CI Test", "-c", "user.email=ci-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Initial fixture");
  return { cwd, git };
}

function run(cwd, paths = ["package-lock.json", "generated"]) {
  return spawnSync(process.execPath, [scriptPath, ...paths], { cwd, encoding: "utf8" });
}

test("accepts a clean real Git worktree", (t) => {
  const { cwd } = repository(t);
  const result = run(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no generated-file or lockfile drift/);
});

test("rejects unstaged lockfile changes without printing file contents", (t) => {
  const { cwd } = repository(t);
  writeFileSync(join(cwd, "package-lock.json"), "private-file-content\n");
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package-lock\.json/);
  assert.doesNotMatch(result.stderr, /private-file-content/);
});

test("rejects staged changes even when the working tree matches the index", (t) => {
  const { cwd, git } = repository(t);
  writeFileSync(join(cwd, "generated", "schema.ts"), "updated schema\n");
  git("add", "generated/schema.ts");
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generated\/schema\.ts/);
});

test("rejects untracked generated schemas", (t) => {
  const { cwd } = repository(t);
  mkdirSync(join(cwd, "generated", "nested"));
  writeFileSync(join(cwd, "generated", "nested", "new-schema.ts"), "new schema\n");
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generated\/nested\/new-schema\.ts/);
});

test("ignores changes outside the selected paths", (t) => {
  const { cwd, git } = repository(t);
  writeFileSync(join(cwd, "other", "readme.md"), "changed docs\n");
  git("add", "other/readme.md");
  writeFileSync(join(cwd, "other", "new-file.md"), "new docs\n");
  assert.equal(run(cwd).status, 0);
});

test("rejects tracked file deletion", (t) => {
  const { cwd } = repository(t);
  rmSync(join(cwd, "generated", "schema.ts"));
  assert.equal(run(cwd).status, 1);
});

test("rejects staged rename", (t) => {
  const { cwd, git } = repository(t);
  renameSync(join(cwd, "generated", "schema.ts"), join(cwd, "generated", "renamed-schema.ts"));
  git("add", "generated");
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /renamed-schema\.ts/);
});

test("rejects empty CLI path lists", (t) => {
  const { cwd } = repository(t);
  const result = run(cwd, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least one non-empty path/);
});

test("rejects blank paths in a non-empty list", () => {
  assert.throws(() => checkClean(["generated", ""]), /at least one non-empty path/);
});

test("fails closed when Git status cannot run", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "liteasy-check-clean-no-git-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "Unable to check Git status. Run this check inside a Git worktree with valid paths.\n");
});

test("treats argument metacharacters as literal path names", (t) => {
  const { cwd } = repository(t);
  const path = "generated/$(exit 42)[schema].ts";
  writeFileSync(join(cwd, path), "new schema\n");
  const result = run(cwd, [path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exit 42/);
});

test("quotes unusual filenames without injecting log lines", { skip: process.platform === "win32" }, (t) => {
  const { cwd } = repository(t);
  writeFileSync(join(cwd, "generated", "schema\n::error::injected.ts"), "private-file-content\n");
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trimEnd().split("\n").length, 2);
  assert.doesNotMatch(result.stderr, /^::error::/m);
  assert.doesNotMatch(result.stderr, /private-file-content/);
});
