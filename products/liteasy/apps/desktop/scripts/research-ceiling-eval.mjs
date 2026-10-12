import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../../../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const casesPath = resolve(root, "development/test-data/research-ceiling/acceptance-cases.json");

// An offline evidence reporter. It never loads credentials, sends sources or ranks
// frameworks from self-reported model grades. Keep every attempt, including failures.
export function summarizeResearchAttempts(cases, attempts) {
  const known = new Set(cases.cases.map((item) => item.id));
  const ids = new Set();
  const groups = new Map();
  for (const row of attempts) {
    if (!known.has(row.caseId) || !row.attemptId || ids.has(row.attemptId)
      || !["completed", "failed", "cancelled", "interrupted", "exhausted"].includes(row.status)
      || !cases.backends.includes(row.backend) || !cases.regimes.includes(row.regime)
      || ["model", "provider", "corpusHash", "toolsHash", "budgetHash", "baselineHash", "rawReceiptRef"].some((key) => typeof row[key] !== "string" || !row[key])) {
      throw new Error("Invalid or duplicate evaluation attempt; bind exact model, inputs, tools, budget and raw receipt.");
    }
    if (row.status !== "completed" && row.failureCause != null && !cases.failureCauses.includes(row.failureCause)) throw new Error("Unknown failure cause.");
    if (!Number.isInteger(row.humanInterventions) || row.humanInterventions < 0) throw new Error("Record human interventions for every attempt.");
    if (row.cost != null && (!Number.isFinite(row.cost) || row.cost < 0 || !row.costUnit)) throw new Error("Invalid measured cost.");
    ids.add(row.attemptId);
    const key = JSON.stringify([row.caseId, row.provider, row.model, row.backend, row.regime, row.corpusHash, row.toolsHash, row.budgetHash, row.baselineHash, row.costUnit ?? null]);
    const group = groups.get(key) ?? { caseId: row.caseId, model: row.model, provider: row.provider, backend: row.backend,
      regime: row.regime, corpusHash: row.corpusHash, toolsHash: row.toolsHash, budgetHash: row.budgetHash, baselineHash: row.baselineHash,
      costUnit: row.costUnit ?? null, attempts: [], terminalCounts: {}, failureCauses: {}, humanInterventions: 0 };
    group.attempts.push(row);
    group.terminalCounts[row.status] = (group.terminalCounts[row.status] ?? 0) + 1;
    if (row.status !== "completed") group.failureCauses[row.failureCause ?? "unclassified"] = (group.failureCauses[row.failureCause ?? "unclassified"] ?? 0) + 1;
    group.humanInterventions += row.humanInterventions;
    groups.set(key, group);
  }
  return { schema: "liteasy.research-ceiling-report/v1", notes: [
    "Three attempts are debugging samples, not a statistical guarantee.",
    "Compare model/harness factors only where corpus, tools and budget hashes match; other comparisons are end-to-end systems.",
    "Null cost or grade means unmeasured. Model self-assessment never counts as independent validation.",
  ], groups: [...groups.values()].map((group) => {
    const validated = group.attempts.filter((row) => row.assessment?.origin === "independent_human"
      && row.assessment.rawReceiptRef === row.rawReceiptRef && typeof row.assessment.correctDecision === "boolean");
    const correct = validated.filter((row) => row.assessment.correctDecision).length;
    const totalCost = group.attempts.every((row) => row.cost != null) ? group.attempts.reduce((sum, row) => sum + row.cost, 0) : null;
    return { ...group, independentAttempts: group.attempts.length, initialReplicationSatisfied: group.attempts.length >= cases.minimumIndependentAttempts,
      validatedAttempts: validated.length, correctDecisions: correct, unassessedAttempts: group.attempts.length - validated.length,
      totalCost, costPerValidatedCorrectDecision: totalCost !== null && correct > 0 ? totalCost / correct : null };
  }) };
}

export async function freezeResearchBaseline() {
  const files = ["src/app/controllers/agent/runWorkspaceAgent.ts", "src/app/controllers/agent/createDesktopAgentService.ts",
    "src/app/features/models/modelGateway.ts", "src/app/features/models/directModelClient.ts", "src/app/features/models/modelPolicy.ts",
    "src/tests/workspaceAgent.test.ts", "src/tests/researchLoop.test.ts", "src/tests/fixtures/researchAblationLabels.ts", ".nvmrc", "package-lock.json"];
  const fileHashes = Object.fromEntries(await Promise.all(files.map(async (path) => [path, hash(await readFile(resolve(desktop, path)))])));
  const suite = await readFile(casesPath);
  return { schema: "liteasy.research-ceiling-baseline/v1", gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    workingTreeFiles: fileHashes, suiteHash: hash(suite), suite: JSON.parse(suite),
    sourceState: "Hashes describe working-tree bytes; gitHead alone does not identify uncommitted changes.",
    providerConfiguration: "Actual provider and exact model are required per attempt; credentials are excluded.",
    defaultResearchBackend: "CodexAppServer", optionalBackends: { OMPDriver: "not_enabled_pending_measured_benefit" },
    modelQuality: "not_measured", generatedAt: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, input, output] = process.argv.slice(2);
  const report = mode === "freeze" ? await freezeResearchBaseline()
    : mode === "score" && input ? summarizeResearchAttempts(JSON.parse(await readFile(casesPath, "utf8")), JSON.parse(await readFile(resolve(input), "utf8")))
      : (() => { throw new Error("Usage: research-ceiling-eval.mjs freeze [new-output.json] | score attempts.json [new-output.json]"); })();
  const destination = resolve(mode === "freeze" ? input ?? "test-results/research-ceiling-baseline.json" : output ?? "test-results/research-ceiling-report.json");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(destination);
}
