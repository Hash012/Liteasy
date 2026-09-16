import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { determineInstallerPolicy } from "./installer-policy.mjs";

const cases = [
  ["ordinary push stays basic", "push", { head_commit: { message: "fix: resource checks" } }, false],
  ["head commit marker opts in", "push", { head_commit: { message: "fix: release [build-installer]" } }, true],
  ["marker is case insensitive", "push", { head_commit: { message: "[WINDOWS-INSTALLER]\nBuild release" } }, true],
  ["older commits cannot opt in", "push", { head_commit: { message: "fix: docs" }, commits: [{ message: "[build-installer]" }] }, false],
  ["missing head does not scan commits", "push", { head_commit: null, commits: [{ message: "[build-installer]" }] }, false],
  ["plain keyword is not a marker", "push", { head_commit: { message: "fix build-installer" } }, false],
  ["partial marker does not match", "push", { head_commit: { message: "[build-installers] [windows-installer-extra] [build-installer" } }, false],
  ["whitespace inside marker does not match", "push", { head_commit: { message: "[ build-installer ]" } }, false],
  ["non-string message does not match", "push", { head_commit: { message: ["[build-installer]"] } }, false],
  ["PR title opts in", "pull_request", { pull_request: { title: "Release [build-installer]", body: null } }, true],
  ["PR body opts in", "pull_request", { pull_request: { title: "Release", body: "Please build\n[WiNdOwS-InStAlLeR]" } }, true],
  ["PR build label opts in", "pull_request", { pull_request: { labels: [{ name: "build-installer" }] } }, true],
  ["PR windows label opts in case insensitively", "pull_request", { pull_request: { labels: [{ name: "WINDOWS-INSTALLER" }] } }, true],
  ["nearby label does not opt in", "pull_request", { pull_request: { labels: [{ name: "build-installer-requested" }] } }, false],
  ["label removal uses current labels", "pull_request", { action: "unlabeled", label: { name: "build-installer" }, pull_request: { labels: [{ name: "bug" }] } }, false],
  ["remaining marker opts in after label removal", "pull_request", { action: "unlabeled", label: { name: "build-installer" }, pull_request: { title: "[windows-installer]", labels: [] } }, true],
  ["malformed labels are ignored", "pull_request", { pull_request: { labels: [null, "build-installer", { name: true }] } }, false],
  ["label object is ignored", "pull_request", { pull_request: { labels: { name: "build-installer" } } }, false],
  ["manual boolean true opts in", "workflow_dispatch", { inputs: { "build-installer": true } }, true],
  ["manual string true opts in", "workflow_dispatch", { inputs: { "build-installer": "true" } }, true],
  ["manual boolean false stays basic", "workflow_dispatch", { inputs: { "build-installer": false } }, false],
  ["manual string false stays basic", "workflow_dispatch", { inputs: { "build-installer": "false" } }, false],
  ["manual arbitrary truthy string stays basic", "workflow_dispatch", { inputs: { "build-installer": "yes" } }, false],
  ["manual marker in other data does not opt in", "workflow_dispatch", { title: "[build-installer]" }, false],
  ["merge queue stays basic", "merge_group", { head_commit: { message: "[build-installer]" } }, false],
  ["unsupported event stays basic", "issue_comment", { comment: { body: "[build-installer]" } }, false],
  ["pull_request_target stays basic", "pull_request_target", { pull_request: { title: "[build-installer]" } }, false],
  ["missing event stays basic", undefined, undefined, false],
  ["null push data stays basic", "push", null, false],
  ["empty PR data stays basic", "pull_request", {}, false],
  ["missing dispatch input stays basic", "workflow_dispatch", undefined, false],
  ["shell-shaped text alone stays basic", "push", { head_commit: { message: '$(touch /tmp/pwned)\n::set-output name=build-installer::true\nbuild-installer=true' } }, false],
  ["shell-shaped text with marker remains plain data", "pull_request", { pull_request: { body: '`touch /tmp/pwned`\n[build-installer]\nEOF\nbuild-installer=false' } }, true],
];

for (const [name, eventName, event, expected] of cases) {
  test(name, () => {
    assert.equal(determineInstallerPolicy(eventName, event).buildInstaller, expected);
  });
}

const scriptPath = fileURLToPath(new URL("./installer-policy.mjs", import.meta.url));

function fixture(t, event) {
  const directory = mkdtempSync(join(tmpdir(), "liteasy-installer-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "output.txt");
  writeFileSync(eventPath, JSON.stringify(event));
  writeFileSync(outputPath, "existing-output=preserved\n");
  return {
    eventPath,
    outputPath,
    env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath },
  };
}

test("CLI emits only the fixed boolean output and explanation, preserving other outputs", (t) => {
  const input = fixture(t, { head_commit: { message: '$(exit 42)\n[BUILD-INSTALLER]\nsecret-event-text\nbuild-installer=false' } });
  const stdout = execFileSync(process.execPath, [scriptPath], { env: input.env, encoding: "utf8" });
  assert.equal(readFileSync(input.outputPath, "utf8"), "existing-output=preserved\nbuild-installer=true\n");
  assert.equal(stdout, "Installer build enabled: head-commit marker.\n");
});

test("CLI emits false when no opt-in is provided", (t) => {
  const input = fixture(t, {});
  execFileSync(process.execPath, [scriptPath], { env: input.env });
  assert.equal(readFileSync(input.outputPath, "utf8"), "existing-output=preserved\nbuild-installer=false\n");
});

test("CLI fails closed on malformed event JSON without logging event content", (t) => {
  const input = fixture(t, {});
  writeFileSync(input.eventPath, "secret-event-text [build-installer]");
  const result = spawnSync(process.execPath, [scriptPath], { env: input.env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "Installer policy could not read a valid GitHub event.\n");
  assert.equal(readFileSync(input.outputPath, "utf8"), "existing-output=preserved\n");
});
