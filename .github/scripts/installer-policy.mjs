import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const installerMarker = /\[(?:build-installer|windows-installer)\]/i;
const installerLabels = new Set(["build-installer", "windows-installer"]);

function hasMarker(value) {
  return typeof value === "string" && installerMarker.test(value);
}

/** Inspect event data without evaluating or emitting any event-provided text. */
export function determineInstallerPolicy(eventName, event = {}) {
  if (eventName === "push") {
    const buildInstaller = hasMarker(event?.head_commit?.message);
    return { buildInstaller, reason: buildInstaller ? "head-commit marker" : "no head-commit marker" };
  }

  if (eventName === "pull_request") {
    const pullRequest = event?.pull_request;
    const marked = hasMarker(pullRequest?.title) || hasMarker(pullRequest?.body);
    const labeled = Array.isArray(pullRequest?.labels) && pullRequest.labels.some((label) => (
      typeof label?.name === "string" && installerLabels.has(label.name.toLowerCase())
    ));
    return {
      buildInstaller: marked || labeled,
      reason: marked ? "pull-request marker" : labeled ? "pull-request label" : "no pull-request opt-in",
    };
  }

  if (eventName === "workflow_dispatch") {
    const input = event?.inputs?.["build-installer"];
    const buildInstaller = input === true || input === "true";
    return { buildInstaller, reason: buildInstaller ? "manual opt-in" : "manual opt-in disabled" };
  }

  return { buildInstaller: false, reason: "event uses basic CI" };
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!eventPath || !outputPath) {
    throw new Error("Installer policy requires GITHUB_EVENT_PATH and GITHUB_OUTPUT.");
  }

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    throw new Error("Installer policy could not read a valid GitHub event.");
  }
  const { buildInstaller, reason } = determineInstallerPolicy(process.env.GITHUB_EVENT_NAME, event);
  appendFileSync(outputPath, `build-installer=${buildInstaller}\n`, "utf8");
  console.log(`Installer build ${buildInstaller ? "enabled" : "disabled"}: ${reason}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
