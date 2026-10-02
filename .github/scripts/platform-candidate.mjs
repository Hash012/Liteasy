import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const candidates = [
  { id: "linux-x64", runner: "ubuntu-24.04", platform: "linux", arch: "x64", target: "x86_64-unknown-linux-gnu", baseline: "Ubuntu 24.04 x64 (build candidate; runtime support unverified)", bundles: "deb", config: "tauri.linux.conf.json" },
  { id: "macos-arm64", runner: "macos-15", platform: "darwin", arch: "arm64", target: "aarch64-apple-darwin", baseline: "macOS 15 Apple Silicon (build candidate; minimum supported OS unverified)", bundles: "app,dmg", config: "tauri.macos.conf.json" },
];

export function candidateMatrix(selection) {
  assert.ok(selection === "both" || candidates.some(({ id }) => id === selection), "Choose linux-x64, macos-arm64 or both explicitly");
  return candidates.filter(({ id }) => selection === "both" || selection === id);
}

export function readRustToolchain(workflow) {
  const pins = [...workflow.matchAll(/^\s*RUST_TOOLCHAIN: (\d+\.\d+\.\d+)\s*$/gm)];
  assert.equal(pins.length, 1, "Expected one pinned Rust toolchain in desktop-windows.yml");
  return pins[0][1];
}

export function requireCandidateSuccess(results) {
  for (const id of ["select", "frontend", "candidate"]) {
    assert.equal(results?.[id]?.result, "success", `${id}: ${results?.[id]?.result ?? "missing result"}`);
  }
}

const commandDefinitions = {
  host: "node .github/scripts/platform-candidate.mjs host",
  frontend: "npm run build",
  rust: "cargo test --locked --target $CANDIDATE_TARGET --manifest-path src-tauri/Cargo.toml",
  compile: "npm run tauri -- build --target $CANDIDATE_TARGET --no-bundle -- --locked",
  package: "npm run tauri -- bundle --target $CANDIDATE_TARGET --bundles $CANDIDATE_BUNDLES",
  inspect: "node .github/scripts/platform-candidate.mjs inspect",
  clean: "node ../../../../.github/scripts/check-clean.mjs package-lock.json src-tauri/Cargo.lock ../../packages/shared",
};

function status(outcome) {
  if (outcome === "success") return "passed";
  if (outcome === "failure") return "failed";
  if (outcome === "cancelled") return "blocked";
  return "not_run";
}

export function createReport(candidate, steps, metadata) {
  const evidence = (id, reason) => ({
    status: status(steps[id]?.outcome), evidence_paths: [metadata.runUrl, `logs/${id}.log`].filter(Boolean), used_mock: null, reason,
  });
  const unexecuted = (reason) => ({ status: "not_run", evidence_paths: [], used_mock: null, reason });
  const required = Object.keys(commandDefinitions);
  const outcomes = required.map((id) => status(steps[id]?.outcome));
  const buildStatus = outcomes.every((value) => value === "passed") ? "passed"
    : outcomes.includes("failed") ? "failed" : outcomes.includes("blocked") ? "blocked" : "not_run";
  return {
    schema: "liteasy.client-verification/v1",
    task_id: "C11",
    head_commit: metadata.commit,
    version: metadata.version,
    enabled_release_tasks: ["C11-platform-candidate"],
    environment: {
      os: metadata.actualPlatform ?? candidate.platform, os_version: metadata.osVersion, arch: metadata.actualArch ?? candidate.arch, webview: null,
      node: metadata.node, rust: metadata.rust, fixture_revision: metadata.commit, test_profile_path_redacted: true,
      runner_image: metadata.runnerImage ?? null, target: candidate.target, os_baseline: candidate.baseline,
      rust_cache_requested: metadata.rustCacheRequested ?? false,
    },
    commands: required.map((id) => ({ command: commandDefinitions[id], status: status(steps[id]?.outcome), exit_code: null, reason: "Actions exposes the step outcome, not the process exit code; consult the command log.", evidence: `logs/${id}.log` })),
    checks: {
      build: { status: buildStatus, evidence_paths: [metadata.runUrl].filter(Boolean), used_mock: false, reason: "Requires every host, frontend, Rust test, Release link, package, structure and cleanliness step; does not execute the packaged app." },
      focused_tests: unexecuted("The separate required frontend workflow runs the full suite; see its JUnit artifacts. No browser result is promoted to native evidence here."),
      typescript_build: evidence("frontend", "Real production frontend; no fabricated dist."),
      rust_locked: evidence("rust", "Native target Rust tests; tests may use fixtures/mocks. This is not packaged-app IPC or native UI evidence."),
      schema_clean: evidence("clean", "Existing locks and generated schema cleanliness gate after the production build regenerates schemas."),
      artifact_structure: evidence("inspect", "Package structure and binary architecture only; no installation or launch."),
      browser_regression: unexecuted("Playwright browser execution is outside this candidate packaging job."),
      native_ipc: unexecuted("No WebdriverIO test build or real Tauri IPC scenario executed."),
      native_window_file_events: unexecuted("Native window, file association, drag/drop, credentials and real file events need separate acceptance."),
      accessibility: unexecuted("Requires native assistive-technology acceptance."),
      performance: unexecuted("Requires native measurements with recorded fixtures."),
      installer_smoke: unexecuted("Package inspection does not install, launch or uninstall the app."),
      upgrade_recovery: unexecuted("No installed predecessor or user-data migration scenario executed."),
      signing: unexecuted("No distribution signing credentials supplied. Any toolchain ad-hoc signing is not distribution signing validation."),
      notarization: unexecuted("No Apple notarization credentials or submission configured."),
      production_driver_absence: unexecuted("No test driver is added by this change; absence of runtime listener/permissions still needs binary acceptance."),
    },
    data_safety: { originals_preserved: true, secrets_excluded: true, network_services_unchanged: true, rollback_or_read_only_strategy: "Candidate artifacts only; no install, user data, schema migration or publication." },
    changed_files: [],
    known_limitations: ["Build runner baseline is not a minimum-OS support promise.", "Native UI, installation, upgrades, distribution signing and runtime driver absence remain unverified."],
    artifacts: [],
    release_ready: false,
    notes: "Build success alone does not authorize distribution. Report outcomes derive from Actions step outcomes; skipped/missing steps never pass.",
  };
}

function bundleEntries(candidate, bundleRoot) {
  const formats = candidate.platform === "linux" ? [["deb", ".deb"]] : [["macos", ".app"], ["dmg", ".dmg"]];
  return formats.flatMap(([folder, suffix]) => {
    const directory = path.join(bundleRoot, folder);
    const entries = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(suffix)).sort() : [];
    assert.equal(entries.length, 1, `Missing or ambiguous ${suffix} candidate: expected exactly one artifact`);
    const source = path.join(directory, entries[0]);
    const stat = fs.lstatSync(source);
    assert.ok(!stat.isSymbolicLink() && (suffix === ".app" ? stat.isDirectory() : stat.isFile()), `Invalid bundle: ${source}`);
    return { source, suffix };
  });
}

export function collectArtifacts(candidate, bundleRoot, output, report) {
  assert.equal(report.checks.build?.status, "passed", "Only passed candidate builds may export artifacts");
  const entries = bundleEntries(candidate, bundleRoot);
  fs.mkdirSync(output, { recursive: true });
  return entries.map(({ source, suffix }) => {
    const filename = `${path.basename(source)}${suffix === ".app" ? ".tar.gz" : ""}`;
    const destination = path.join(output, filename);
    if (suffix === ".app") {
      // Preserve the app bundle's executable modes and symlinks through artifact upload.
      execFileSync("tar", ["-czf", destination, "-C", path.dirname(source), path.basename(source)]);
    } else fs.copyFileSync(source, destination);
    const bytes = fs.readFileSync(destination);
    const artifact = {
      filename, format: suffix.slice(1), commit: report.head_commit, version: report.version,
      target: candidate.target, os_baseline: candidate.baseline,
      sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
      report: "verification-report.json", release_ready: false,
    };
    fs.writeFileSync(`${destination}.sha256`, `${artifact.sha256}  ${filename}\n`);
    fs.writeFileSync(`${destination}.metadata.json`, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifact;
  });
}

function run(command, args) {
  const output = execFileSync(command, args, { encoding: "utf8" });
  process.stdout.write(output);
  return output.trim();
}

function inspect(candidate, root) {
  for (const { source, suffix } of bundleEntries(candidate, root)) {
    if (suffix === ".deb") {
      assert.equal(run("dpkg-deb", ["--field", source, "Architecture"]), "amd64");
      run("dpkg-deb", ["--info", source]);
      const contents = run("dpkg-deb", ["--contents", source]);
      assert.match(contents, /\.\/usr\/bin\/liteasy-desktop(?:\n|$)/m);
    } else if (suffix === ".app") {
      run("plutil", ["-lint", path.join(source, "Contents", "Info.plist")]);
      assert.equal(run("lipo", ["-archs", path.join(source, "Contents", "MacOS", "liteasy-desktop")]), "arm64");
    } else run("hdiutil", ["verify", source]);
  }
}

function main() {
  const mode = process.argv[2];
  if (mode === "select") {
    const matrix = candidateMatrix(process.env.CANDIDATE_SELECTION);
    const rust = readRustToolchain(fs.readFileSync(".github/workflows/desktop-windows.yml", "utf8"));
    assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: matrix })}\nrust=${rust}\n`);
    return;
  }
  if (mode === "require-success") {
    requireCandidateSuccess(JSON.parse(process.env.CI_RESULTS ?? "{}"));
    const summary = "All selected candidate builds and artifact checks passed. Native UI/IPC, install/upgrade, signing and notarization remain not_run. These artifacts are not release-ready.\n";
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    return;
  }
  const [candidate] = candidateMatrix(process.env.CANDIDATE_ID);
  assert.notEqual(process.env.CANDIDATE_ID, "both", "Select one native job candidate");
  const desktop = "products/liteasy/apps/desktop";
  const bundleRoot = path.resolve(desktop, "src-tauri/target", candidate.target, "release/bundle");
  if (mode === "host") {
    assert.equal(process.platform, candidate.platform, "Must build on the native OS");
    assert.equal(process.arch, candidate.arch, "Must build on the native architecture");
    if (candidate.platform === "linux") {
      const release = fs.readFileSync("/etc/os-release", "utf8");
      assert.match(release, /^ID=ubuntu$/m);
      assert.match(release, /^VERSION_ID="24\.04"$/m);
    } else assert.match(run("sw_vers", ["-productVersion"]), /^15\./);
    const config = JSON.parse(fs.readFileSync(path.join(desktop, "src-tauri", candidate.config), "utf8"));
    assert.deepEqual(config.bundle.targets, candidate.bundles.split(","));
    assert.equal(run("rustc", ["-vV"]).match(/^host: (.+)$/m)?.[1], candidate.target);
    run("node", ["--version"]);
    run("cargo", ["--version"]);
    return;
  }
  if (mode === "inspect") return inspect(candidate, bundleRoot);
  assert.equal(mode, "report", "Expected select, host, inspect, report or require-success");
  const version = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")).version;
  const report = createReport(candidate, JSON.parse(process.env.CANDIDATE_STEPS ?? "{}"), {
    commit: process.env.GITHUB_SHA, version, node: process.version,
    rust: process.env.CANDIDATE_RUST ?? null, osVersion: `${os.type()} ${os.release()} ${os.version()}`,
    actualPlatform: process.platform, actualArch: process.arch,
    runnerImage: `${process.env.ImageOS ?? "unknown"} / ${process.env.ImageVersion ?? "unknown"}`,
    rustCacheRequested: process.env.CANDIDATE_RUST_CACHE === "true",
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
  });
  const output = path.resolve(process.env.RUNNER_TEMP, "liteasy-candidate", candidate.id);
  fs.mkdirSync(output, { recursive: true });
  let artifactError;
  try {
    if (report.checks.build.status === "passed") report.artifacts = collectArtifacts(candidate, bundleRoot, output, report);
  } catch (error) {
    artifactError = error;
    report.checks.build.status = "failed";
    report.known_limitations.push(`Artifact export failed: ${error.message}`);
  }
  fs.writeFileSync(path.join(output, "verification-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const summary = `${candidate.id}: build=${report.checks.build.status}; native_ipc=not_run; install=not_run; signing=not_run; release_ready=false\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (artifactError) throw artifactError;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
