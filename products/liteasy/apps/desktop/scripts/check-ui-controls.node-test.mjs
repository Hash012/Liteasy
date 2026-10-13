import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { scanText } from "./ui-control-scanner.mjs";
import { checkControlDecisions } from "./check-ui-controls.mjs";
const file = "products/liteasy/apps/desktop/src/app/example.tsx";
test("AST audit sees imported aliases and raw controls without confusing similarly named components", () => {
  const { findings, parseErrors } = scanText(ts, file, 'import {Select as Choice} from "@fluentui/react-components"; export const View=()=> <><Choice /><SelectionLookupCard /><details><summary>Info</summary></details></>;');
  assert.equal(parseErrors.length, 0);
  assert.deepEqual(findings.map(item => item.rule), ["fluent-select", "native-details", "native-summary"]);
});
test("candidate decisions are exact, owned and invalidated by source changes", () => {
  const findings = scanText(ts, file, 'export const View=()=> <details><summary>Info</summary></details>;').findings;
  const report = { findings, errors: [] };
  assert.equal(checkControlDecisions(report, { entries: [] }).length, 2);
  const entries = findings.map(item => ({ fingerprint: item.fingerprint, file, reviewedGitBlob: item.git_blob_sha1, decision: "keep-content", owner: "content renderer", reason: "Authored markup", acceptanceTest: "authored HTML retention", renderedSurface: "user document" }));
  assert.equal(checkControlDecisions(report, { entries }).length, 0);
  assert.equal(checkControlDecisions({ findings: [], errors: [] }, { entries }).length, 2);
  assert.equal(checkControlDecisions(report, { entries: [...entries, entries[0]] }).length, 1);
  entries[0].reviewedGitBlob = "old";
  assert.equal(checkControlDecisions(report, { entries }).length, 1);
  assert.equal(checkControlDecisions({ findings: [], errors: [{ file, message: "parse failure" }] }, { entries: [] }).length, 1);
});
test("template and generated HTML controls remain visible to the audit", () => {
  assert.deepEqual(scanText(ts, "products/marketing/index.html", '<select name="role" required></select>').findings.map(item => item.rule), ["template-select"]);
  assert.equal(scanText(ts, "development/dev-cloud/example.mjs", 'export const html = `<select></select>`;').findings[0].rule, "embedded-select");
});
