import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const cohorts = ["reader", "beginner", "researcher", "review", "visual", "humanities", "moderator", "agent"];
export const tasks = ["first-unassisted-task", "audience-understanding", "second-use", "correction-return", "failure-recovery"];
const statuses = ["pass", "fail", "blocked", "not_run"];
const hashPattern = /^[a-f0-9]{64}$/;

export function emptyPilotRecord() {
  return { schema: "liteasy.voluntary-pilot/v1", kind: "voluntary-human", status: "not_run", consent: false,
    participantCode: null, cohort: null, testedCommit: null, platform: null,
    observations: tasks.map((task) => ({ task, status: "not_run", assisted: null, elapsedSeconds: null, evidenceSha256: null })),
    costs: null };
}

function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function validatePilotRecord(record) {
  requireValue(record?.schema === "liteasy.voluntary-pilot/v1" && record.kind === "voluntary-human", "not a voluntary human pilot record");
  requireValue(statuses.includes(record.status), "invalid status");
  requireValue(Array.isArray(record.observations) && record.observations.length === tasks.length, "record every task, including failures and unrun tasks");
  requireValue(new Set(record.observations.map((item) => item.task)).size === tasks.length, "duplicate tasks");
  const actual = record.observations.some((item) => item.status !== "not_run");
  if (actual) {
    requireValue(record.consent === true, "explicit consent required before observations");
    requireValue(/^participant-[a-z0-9]{6,32}$/.test(record.participantCode ?? ""), "use a nonidentifying participant code");
    requireValue(cohorts.includes(record.cohort), "unknown cohort");
    requireValue(/^[a-f0-9]{40}$/.test(record.testedCommit ?? ""), "tested commit required");
    requireValue(["windows", "linux", "macos", "browser", "android", "ios"].includes(record.platform), "actual platform required");
  }
  for (const item of record.observations) {
    requireValue(tasks.includes(item.task) && statuses.includes(item.status), "unknown task/status");
    requireValue(item.elapsedSeconds === null || Number.isFinite(item.elapsedSeconds) && item.elapsedSeconds >= 0, "invalid duration");
    if (item.status === "not_run") requireValue(item.assisted === null && item.elapsedSeconds === null && item.evidenceSha256 === null, "unrun is not an observed result");
    else requireValue(typeof item.assisted === "boolean" && hashPattern.test(item.evidenceSha256 ?? ""), "observed results require evidence and assistance state");
  }
  const expectedStatus = record.observations.some((item) => item.status === "fail") ? "fail"
    : record.observations.some((item) => item.status === "blocked") ? "blocked"
      : record.observations.every((item) => item.status === "pass") ? "pass" : "not_run";
  requireValue(record.status === expectedStatus, "overall result must preserve failures and incomplete observations");
  if (record.costs !== null) {
    requireValue(actual && record.costs.measurement === "actual" && hashPattern.test(record.costs.evidenceSha256 ?? ""), "only actual metered costs with evidence may be recorded");
    requireValue(/^[A-Z]{3}$/.test(record.costs.currency ?? "") && Number.isFinite(record.costs.amount) && record.costs.amount >= 0, "invalid measured cost");
    requireValue(["storage", "transfer", "model", "support"].includes(record.costs.category), "unknown measured cost category");
  }
  return record;
}

export function summarizePilotRecords(records) {
  records.forEach(validatePilotRecord);
  return { schema: "liteasy.voluntary-pilot-summary/v1",
    participation: records.some((record) => record.consent && record.observations.some((item) => item.status !== "not_run")) ? "observed" : "not_run",
    cohorts: cohorts.map((cohort) => ({ cohort, observations: tasks.map((task) => {
      const values = records.filter((record) => record.cohort === cohort).flatMap((record) => record.observations.filter((item) => item.task === task));
      return { task, ...Object.fromEntries(statuses.map((status) => [status, values.filter((item) => item.status === status).length])), unassistedPass: values.filter((item) => item.status === "pass" && item.assisted === false).length };
    }) })),
    // No inferred retention, conversion, prices, aggregate costs across currencies,
    // participant identifiers or raw notes are included in portable summaries.
    businessConclusions: "not_established" };
}

function main() {
  const [operation, ...paths] = process.argv.slice(2);
  if (operation === "--init" && paths.length === 1) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const parent = fs.realpathSync(path.dirname(path.resolve(paths[0])));
    requireValue(parent !== root && !parent.startsWith(root + path.sep), "keep participant records outside the checkout");
    fs.writeFileSync(path.join(parent, path.basename(paths[0])), `${JSON.stringify(emptyPilotRecord(), null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log("Empty record created; no participant has been observed.");
    return;
  }
  requireValue(["--validate", "--summary"].includes(operation) && paths.length > 0, "use --init FILE, --validate FILE..., or --summary FILE...");
  const records = paths.map((file) => validatePilotRecord(JSON.parse(fs.readFileSync(file, "utf8"))));
  console.log(operation === "--summary" ? JSON.stringify(summarizePilotRecords(records), null, 2) : "Records valid; validation does not verify participant authenticity.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
