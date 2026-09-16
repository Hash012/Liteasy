import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Fail if selected paths contain tracked or untracked changes. */
export function checkClean(paths, { cwd } = {}) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== "string" || !path.trim())) {
    throw new Error("Provide at least one non-empty path to check.");
  }

  let status;
  try {
    status = execFileSync("git", [
      "--literal-pathspecs", "-c", "core.quotePath=true",
      "status", "--porcelain=v1", "--untracked-files=all", "--", ...paths,
    ], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Unable to check Git status. Run this check inside a Git worktree with valid paths.");
  }

  const changes = status.split("\n").filter(Boolean);
  if (changes.length > 0) {
    // Quote each status entry so even filenames containing control characters
    // cannot inject additional log lines or GitHub workflow commands.
    throw new Error([
      "Generated files or lockfiles changed. Regenerate and commit the selected paths:",
      ...changes.map((change) => `  - ${JSON.stringify(change)}`),
    ].join("\n"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkClean(process.argv.slice(2));
    console.log("Selected paths match Git; no generated-file or lockfile drift detected.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
