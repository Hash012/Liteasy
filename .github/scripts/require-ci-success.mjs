import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function requireCiSuccess(results) {
  for (const job of ["policy", "frontend", "windows"]) {
    assert.equal(results?.[job]?.result, "success", `${job}: ${results?.[job]?.result ?? "missing result"}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = JSON.parse(process.env.CI_RESULTS ?? "{}");
  requireCiSuccess(results);
  const message = process.env.BUILD_INSTALLER === "true"
    ? "All requested checks, Windows Release compilation and NSIS packaging passed. Installation and UI acceptance require manual verification.\n"
    : "Basic checks and Windows development compilation passed. This run did not validate production embedding, Release linking or NSIS packaging.\n";
  process.stdout.write(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
}
