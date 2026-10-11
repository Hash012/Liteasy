import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This command reads human labels only. It never loads API credentials or calls a model.
if (!process.argv[2]) throw new Error("用法：node scripts/research-loop-score.mjs <已人工标注 worksheet.json> [原始运行报告.json]");
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [resolve(desktop, "node_modules/vitest/vitest.mjs"), "run", "src/tests/researchAblationLabels.test.ts", "--reporter=verbose"], {
  cwd: desktop,
  env: { ...process.env, LITEASY_RESEARCH_ABLATION_LABELS: resolve(process.argv[2]), ...(process.argv[3] ? { LITEASY_RESEARCH_ABLATION_RESULTS: resolve(process.argv[3]) } : {}) },
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
