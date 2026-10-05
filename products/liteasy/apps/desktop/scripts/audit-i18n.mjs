#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const findings = [];
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) { if (!["tests", "locales"].includes(item.name)) walk(full); continue; }
    if (!/\.tsx?$/.test(item.name) || item.name.endsWith(".d.ts") || item.name === "messageTypes.ts") continue;
    const text = fs.readFileSync(full, "utf8");
    const file = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, full.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const value = (node.text ?? node.getText(file)).trim();
        if (!/[\u3400-\u9fff]/.test(value)) return;
        const parent = node.parent;
        const role = ts.isJsxText(node) || ts.isJsxAttribute(parent) ? "likely-visible-ui" : "review-required";
        const position = file.getLineAndCharacterOfPosition(node.getStart(file));
        findings.push({ path: path.relative(root, full).split(path.sep).join("/"), line: position.line + 1, column: position.character + 1, role, text: value });
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
}
walk(sourceRoot);
const report = { generatedAt: new Date().toISOString(), scope: "CJK literals only; English hard-codes and indirect/generated text need separate review", warning: "Do not auto-translate AI prompts, fixtures, identifiers, user documents, diagnostics or protocol values. This is an inventory, not a coverage percentage.", count: findings.length, findings };
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  if (!process.argv[outputIndex + 1]) throw new Error("--output needs a file path");
  const output = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${findings.length} review candidates to ${output}`);
} else console.log(JSON.stringify(report, null, 2));
