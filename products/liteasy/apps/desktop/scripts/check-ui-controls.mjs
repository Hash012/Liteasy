import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classification, inventoryPaths, loadTypeScript, scanText } from "./ui-control-scanner.mjs";
import { readControlSource } from "./ui-control-source.mjs";
const directory = path.dirname(fileURLToPath(import.meta.url));
export function collectControlCandidates(root) {
  const ts = loadTypeScript(root), findings = [], errors = [];
  let scanned = 0;
  for (const file of inventoryPaths(root).paths) {
    if (classification(file).startsWith("excluded-")) continue;
    try {
      const result = scanText(ts, file, readControlSource(root, file));
      scanned++; findings.push(...result.findings); errors.push(...result.parseErrors.map(error => ({ file, ...error })));
    } catch (error) { errors.push({ file, message: error.message }); }
  }
  return { schema: "liteasy.control-candidates/v2", scanned, findings, errors };
}
export function checkControlDecisions(report, ledger) {
  const entries = new Map(ledger.entries.map(entry => [entry.fingerprint, entry]));
  const errors = [...report.errors];
  const candidates = new Set(report.findings.map(item => item.fingerprint));
  if (entries.size !== ledger.entries.length) errors.push({ message: "Duplicate control decisions" });
  for (const entry of ledger.entries) if (!candidates.has(entry.fingerprint)) errors.push({ file: entry.file, message: "Stale control decision" });
  for (const finding of report.findings) {
    const entry = entries.get(finding.fingerprint);
    if (!entry || entry.file !== finding.file || !entry.owner || !entry.reason || !entry.acceptanceTest || !entry.renderedSurface || !["migrate", "keep-content", "platform-exception", "development-only"].includes(entry.decision)) errors.push({ file: finding.file, rule: finding.rule, message: "Unreviewed control candidate" });
    else if (entry.reviewedGitBlob !== finding.git_blob_sha1) errors.push({ file: finding.file, message: "Control source changed; review the exact candidate again" });
  }
  return errors;
}
export function checkUiControls() {
  const root = path.resolve(directory, "../../../../..");
  const report = collectControlCandidates(root);
  const ledger = JSON.parse(fs.readFileSync(path.join(directory, "ui-control-decisions.json"), "utf8"));
  const errors = checkControlDecisions(report, ledger);
  if (errors.length) throw new Error(`UI control review failed:\n${JSON.stringify(errors, null, 2)}`);
  console.log(`UI control review: ${report.scanned} sources read, ${report.findings.length} exact candidates accounted for. Static audit is not visual acceptance.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkUiControls();
