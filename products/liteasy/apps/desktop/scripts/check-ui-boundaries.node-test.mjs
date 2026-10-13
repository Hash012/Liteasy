import { test } from "node:test";
import assert from "node:assert/strict";
import { scanUiSource, checkUiFindings, checkUiInventory } from "./check-ui-boundaries.mjs";
const file = "src/app/features/example/Example.tsx";
for (const [rule, source] of [
  ["inline-ui-literal", 'export const X = () => <div style={{ color: "#fff", backgroundColor: "black" }}>text</div>;'],
  ["second-theme-root", 'export const X = () => <FluentProvider theme={custom}>x</FluentProvider>;'],
  ["unowned-portal", 'createPortal(<div>unowned portal</div>, document.body);'],
  ["parallel-markdown", 'import Markdown from "react-markdown";'],
  ["native-interaction", 'export const X = () => <textarea aria-label="scattered" />;'],
  ["second-ui-system", 'import Button from "@mui/material/Button";'],
]) test(`rejects ${rule} through actual TypeScript AST gate`, () => {
  const findings = scanUiSource(file, source);
  assert.ok(findings.some(finding => finding.rule === rule)); assert.ok(checkUiFindings(findings, []).length);
});
test("business CSS declarations, shadows and arbitrary layers fail while semantic tokens pass", () => {
  const findings = scanUiSource("src/app/features/example/example.css", ".control { color: #fff; background: black; z-index: 99999; box-shadow: 0 0 3px; }");
  assert.equal(findings.length, 4);
  assert.deepEqual(scanUiSource("src/app/features/example/example.css", ".control { color: var(--text-primary); background: var(--surface-base); z-index: var(--layer-overlay); box-shadow: var(--shadow8); }"), []);
});
test("an exact grandfathered control never permits a second copy or another file", () => {
  const one = scanUiSource(file, '<button type="button">Old</button>')[0];
  assert.equal(checkUiFindings([one], [{ ...one, count: 1 }]).length, 0);
  assert.equal(checkUiFindings([one, one], [{ ...one, count: 1 }]).length, 1);
  assert.equal(checkUiFindings([{ ...one, file: "other.tsx" }], [{ ...one, count: 1 }]).length, 1);
});
test("authored graphics fill and raw document content are not UI color rules", () => {
  assert.deepEqual(scanUiSource("src/app/features/example/example.css", "svg { fill: #e34; stroke: #123; }"), []);
  assert.deepEqual(scanUiSource(file, 'const markdown = "# white paper"; const scientificPalette = { color: "#fa3" };'), []);
});

test("renamed and namespace imports cannot bypass theme and portal ownership", () => {
  assert.ok(scanUiSource(file, 'import { FluentProvider as Root } from "@fluentui/react-components"; const X = <Root />;').some(x => x.rule === "second-theme-root"));
  assert.ok(scanUiSource(file, 'import * as F from "@fluentui/react-components"; const X = <F.FluentProvider />;').some(x => x.rule === "second-theme-root"));
  assert.ok(scanUiSource(file, 'import { createPortal as teleport } from "react-dom"; teleport(<div />, document.body);').some(x => x.rule === "unowned-portal"));
  assert.ok(scanUiSource("src/app/features/example/example.css", '.control { border-top: 1px solid #fff; }').some(x => x.rule === "ui-color-literal"));
});

test("a new surface must be named in the inventory rather than silently bypassing migration", () => {
  assert.deepEqual(checkUiInventory(["A.tsx", "B.tsx", "tokens.css"], [{ path: "A.tsx" }]), ["B.tsx"]);
});
