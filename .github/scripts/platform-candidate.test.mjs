import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { candidateMatrix, createReport, collectArtifacts, readRustToolchain, requireCandidateSuccess } from "./platform-candidate.mjs";

const success = Object.fromEntries(["host", "frontend", "rust", "compile", "package", "inspect", "clean"].map((id) => [id, { outcome: "success" }]));
const metadata = { commit: "a".repeat(40), version: "0.1.32", node: "v22.23.2", rust: "rustc test", osVersion: "Ubuntu 24.04", runUrl: "https://example.invalid/run/1" };

test("candidate selection is explicit and rejects unexpected input", () => {
  assert.deepEqual(candidateMatrix("both").map((item) => item.id), ["linux-x64", "macos-arm64"]);
  assert.equal(candidateMatrix("linux-x64")[0].target, "x86_64-unknown-linux-gnu");
  assert.equal(candidateMatrix("macos-arm64")[0].runner, "macos-15");
  for (const input of [undefined, "", "windows", "macos-intel", "$(touch nope)"]) assert.throws(() => candidateMatrix(input));
});

test("Rust pin is read from the unchanged Windows workflow without a fallback", () => {
  assert.equal(readRustToolchain("env:\n      RUST_TOOLCHAIN: 1.98.1\n"), "1.98.1");
  for (const input of ["", "RUST_TOOLCHAIN: stable", "RUST_TOOLCHAIN: 1.98.1\nRUST_TOOLCHAIN: 1.98.2"]) assert.throws(() => readRustToolchain(input));
});

test("successful packaging never promotes native UI, installation or signing evidence", () => {
  const report = createReport(candidateMatrix("linux-x64")[0], success, metadata);
  assert.equal(report.checks.build.status, "passed");
  assert.equal(report.checks.rust_locked.status, "passed");
  for (const key of ["native_ipc", "native_window_file_events", "installer_smoke", "upgrade_recovery", "signing", "notarization"]) {
    assert.equal(report.checks[key].status, "not_run", key);
    assert.equal(report.checks[key].used_mock, null);
  }
  assert.equal(report.release_ready, false);
  assert.equal(report.environment.webview, null);
});

test("failed, cancelled, missing and skipped build requirements cannot report a build pass", () => {
  for (const id of Object.keys(success)) {
    for (const outcome of ["failure", "cancelled", "skipped", undefined]) {
      const report = createReport(candidateMatrix("linux-x64")[0], { ...success, [id]: { outcome } }, metadata);
      assert.notEqual(report.checks.build.status, "passed", `${id}: ${outcome}`);
    }
  }
});

test("candidate aggregate fails for every omitted required layer", () => {
  const jobs = Object.fromEntries(["select", "frontend", "candidate"].map((id) => [id, { result: "success" }]));
  requireCandidateSuccess(jobs);
  for (const id of Object.keys(jobs)) {
    for (const result of ["skipped", "failure", "cancelled", undefined]) assert.throws(() => requireCandidateSuccess({ ...jobs, [id]: { result } }));
  }
});

test("artifact records include exact bytes, SHA256 and revision and reject incomplete package sets", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "liteasy-candidate-"));
  try {
    const bundles = path.join(directory, "bundle");
    const output = path.join(directory, "output");
    mkdirSync(path.join(bundles, "deb"), { recursive: true });
    writeFileSync(path.join(bundles, "deb", "Liteasy.deb"), "synthetic test bytes");
    const report = createReport(candidateMatrix("linux-x64")[0], success, metadata);
    const records = collectArtifacts(candidateMatrix("linux-x64")[0], bundles, output, report);
    assert.equal(records.length, 1);
    assert.equal(records[0].commit, metadata.commit);
    assert.equal(records[0].version, metadata.version);
    assert.equal(records[0].sha256, createHash("sha256").update("synthetic test bytes").digest("hex"));
    assert.equal(records[0].bytes, Buffer.byteLength("synthetic test bytes"));
    assert.equal(readFileSync(path.join(output, "Liteasy.deb"), "utf8"), "synthetic test bytes");
    assert.equal(JSON.parse(readFileSync(path.join(output, "Liteasy.deb.metadata.json"))).report, "verification-report.json");
    assert.throws(() => collectArtifacts(candidateMatrix("macos-arm64")[0], bundles, output, report), /Missing/);
    assert.throws(() => collectArtifacts(candidateMatrix("linux-x64")[0], bundles, output, { ...report, checks: {} }), /passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("app artifact transport preserves synthetic executable modes and symlinks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "liteasy-app-archive-"));
  try {
    const bundles = path.join(directory, "bundle");
    const app = path.join(bundles, "macos", "Liteasy.app", "Contents", "MacOS");
    const output = path.join(directory, "output");
    const extracted = path.join(directory, "extracted");
    mkdirSync(app, { recursive: true });
    mkdirSync(path.join(bundles, "dmg"), { recursive: true });
    mkdirSync(extracted);
    writeFileSync(path.join(app, "liteasy-desktop"), "synthetic executable fixture");
    chmodSync(path.join(app, "liteasy-desktop"), 0o755);
    symlinkSync("liteasy-desktop", path.join(app, "fixture-link"));
    writeFileSync(path.join(bundles, "dmg", "Liteasy.dmg"), "synthetic dmg fixture");
    const candidate = candidateMatrix("macos-arm64")[0];
    const records = collectArtifacts(candidate, bundles, output, createReport(candidate, success, metadata));
    assert.deepEqual(records.map((item) => item.format), ["app", "dmg"]);
    execFileSync("tar", ["-xzf", path.join(output, "Liteasy.app.tar.gz"), "-C", extracted]);
    const executable = path.join(extracted, "Liteasy.app", "Contents", "MacOS", "liteasy-desktop");
    assert.equal(lstatSync(executable).mode & 0o777, 0o755);
    assert.equal(readlinkSync(path.join(path.dirname(executable), "fixture-link")), "liteasy-desktop");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
