import { afterEach, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const attempt = (id: string, status = "completed") => ({ attemptId: id, caseId: "holdout-reassessment", status,
  model: "explicit-model-version", provider: "selected-provider", backend: "CodexAppServer", regime: "equal_budget",
  corpusHash: "fixed-corpus", toolsHash: "fixed-tools", budgetHash: "fixed-budget", baselineHash: "frozen-baseline",
  rawReceiptRef: `host-run/${id}`, cost: 2, costUnit: "measured-unit", humanInterventions: 1,
  ...(status === "completed" ? {} : { failureCause: "execution" }) });
async function score(rows: unknown[]) {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-ceiling-")); directories.push(directory);
  const input = join(directory, "attempts.json"), output = join(directory, "report.json");
  await writeFile(input, JSON.stringify(rows));
  execFileSync(process.execPath, ["scripts/research-ceiling-eval.mjs", "score", input, output], { cwd: resolve("."), stdio: "pipe" });
  return JSON.parse(await readFile(output, "utf8"));
}
test("evaluation retains failures, unknown cost and interventions instead of selecting the best answer", async () => {
  const a = attempt("a"), b = attempt("b", "failed"), c = attempt("c", "cancelled");
  const report = await score([{ ...a, assessment: { origin: "independent_human", rawReceiptRef: a.rawReceiptRef, correctDecision: true } },
    b, { ...c, cost: null }]);
  expect(report.groups[0]).toMatchObject({ independentAttempts: 3, initialReplicationSatisfied: true,
    terminalCounts: { completed: 1, failed: 1, cancelled: 1 }, failureCauses: { execution: 2 },
    validatedAttempts: 1, correctDecisions: 1, unassessedAttempts: 2, humanInterventions: 3,
    totalCost: null, costPerValidatedCorrectDecision: null });
});
test("self-grades and annotations for another receipt cannot improve reported quality", async () => {
  const a = attempt("a"), b = attempt("b");
  const report = await score([{ ...a, assessment: { origin: "model", rawReceiptRef: a.rawReceiptRef, correctDecision: true } },
    { ...b, assessment: { origin: "independent_human", rawReceiptRef: "other-run", correctDecision: true } }]);
  expect(report.groups[0]).toMatchObject({ validatedAttempts: 0, correctDecisions: 0, unassessedAttempts: 2, totalCost: 4 });
  await expect(score([a, a])).rejects.toThrow();
});
test("different tools, budgets and exact models remain separate comparison groups", async () => {
  const report = await score([attempt("a"), { ...attempt("b"), toolsHash: "different-tools" },
    { ...attempt("c"), model: "other-version" }, { ...attempt("d"), budgetHash: "larger-budget" }]);
  expect(report.groups).toHaveLength(4);
  expect(report.groups.every((group: any) => !group.initialReplicationSatisfied)).toBe(true);
});
