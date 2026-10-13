import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
const report = process.env.LITEASY_QUICKASK_LIVE_REPORT || resolve("../../../../tmp/quick-ask-evidence/live-results.json");
mkdirSync(resolve(report, ".."), { recursive: true });
if (process.env.LITEASY_QUICKASK_LIVE_ALLOW_PAID !== "explicitly-authorized" || !process.env.LITEASY_QUICKASK_LIVE_CONFIG) {
  const result = { status: "not_run", reason: "user_declined_paid_calls_or_no_explicit_configuration", modelAttempts: 0, tasks: 5, repetitions: 3 };
  writeFileSync(report, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} else {
  const child = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/tests/quickAskLive.test.ts"], {
    stdio: "inherit", env: { ...process.env, LITEASY_QUICKASK_LIVE_REPORT: report }
  });
  process.exitCode = child.status ?? 1;
}
