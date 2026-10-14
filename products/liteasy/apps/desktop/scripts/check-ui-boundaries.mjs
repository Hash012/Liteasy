import fs from "node:fs";
import { checkUiControls } from "./check-ui-controls.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Reuse the locked Vite toolchain CSS parser; no second stylesheet parser or dependency.
const postcss = createRequire(require.resolve("vite/package.json"))("postcss");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const color = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]|\b(?:white|black|red|blue|gray|grey)\b/i;
const uiProperties = /^(?:color|background(?:Color|-color)?|border(?:(?:Top|Right|Bottom|Left)?Color|-(?:top|right|bottom|left)(?:-color)?|-color)?|boxShadow|box-shadow|textShadow|text-shadow|zIndex|z-index)$/;
const themeOwners = new Map([
  ["src/app/features/theme/ApplicationThemeProvider.tsx", "Single application theme owner"],
  ["src/app/features/workflow-studio/WorkflowStudio.tsx", "Explicit inherit/light/dark authored preview, existing contract"],
]);
const portalOwners = new Map([
  ["src/app/layout/AppShell.tsx", "Existing stable assistant host remains inside the application provider"],
  ["src/app/features/markdown/MarkdownLiveEditor.tsx", "CodeMirror ContentView widgets inside the inherited editor DOM"],
]);
export function scanUiSource(file, text) {
  const findings = [];
  const report = (rule, detail) => findings.push({ file, rule, detail: detail.replace(/\s+/g, " ").trim() });
  if (file.endsWith(".css")) {
    const tree = postcss.parse(text, { from: file });
    tree.walkDecls(decl => {
      if (!uiProperties.test(decl.prop)) return;
      if (file.includes("/theme/")) return; // Named semantic palette/layer owner, not business CSS.
      if (decl.prop === "z-index") { if (/^-?\d+$/.test(decl.value)) report("layer-literal", `${decl.parent.selector} { ${decl.prop}: ${decl.value} }`); }
      else if (color.test(decl.value)) report("ui-color-literal", `${decl.parent.selector} { ${decl.prop}: ${decl.value} }`);
      else if (/shadow/i.test(decl.prop) && decl.value !== "none" && !decl.value.includes("var(")) report("shadow-literal", `${decl.parent.selector} { ${decl.prop}: ${decl.value} }`);
    });
    return findings;
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const themeTags = new Set(["FluentProvider"]), portalCalls = new Set(["createPortal"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (statement.moduleSpecifier.text === "@fluentui/react-components" && imported === "FluentProvider") themeTags.add(element.name.text);
      if (statement.moduleSpecifier.text === "react-dom" && imported === "createPortal") portalCalls.add(element.name.text);
    }
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (statement.moduleSpecifier.text === "@fluentui/react-components") themeTags.add(`${bindings.name.text}.FluentProvider`);
      if (statement.moduleSpecifier.text === "react-dom") portalCalls.add(`${bindings.name.text}.createPortal`);
    }
  }
  const visit = node => {
    if (!/\/features\/(?:help|onboarding)\//.test(file) && (ts.isJsxText(node) || ts.isStringLiteral(node)) &&
      /整篇论文问答；也可在项目中按页选择原文或图片|先看看内容|点击资产查看说明|搜索名称的一部分，或按类别、项目浏览/.test(node.text)) report("teaching-template", node.text);
    if (/\/features\/(?:assistant|resource-links)\//.test(file) && ts.isNewExpression(node) && node.expression.getText(source) === "Map" &&
      /\[\s*(?:\w+\.label|contextName\(\w+\))\s*,\s*\w+\s*\]/.test(node.getText(source))) report("reference-title-identity", node.getText(source));
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "className" &&
      attr.initializer && /context-asset-card|asset-row|figure-tile/.test(attr.initializer.getText(source))) &&
      node.children.some(child => ts.isJsxExpression(child) && child.expression && /\.(description|helpText)\b/.test(child.expression.getText(source)))) report("card-helper-prose", node.getText(source));
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.text;
      if (/^(?:@mui\/|@radix-ui\/|antd$|@chakra-ui\/)/.test(name)) report("second-ui-system", name);
      if (/^(?:react-markdown|marked|markdown-it)$/.test(name) && !node.importClause?.isTypeOnly && file !== "src/app/features/markdown/MarkdownContent.tsx") report("parallel-markdown", name);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (["button", "input", "textarea", "select"].includes(tag)) report("native-interaction", node.getText(source));
      if (themeTags.has(tag) && !themeOwners.has(file)) report("second-theme-root", node.getText(source));
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(source) !== "style" || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression || !ts.isObjectLiteralExpression(attr.initializer.expression)) continue;
        for (const entry of attr.initializer.expression.properties) {
          if (!ts.isPropertyAssignment(entry) || !uiProperties.test(entry.name.getText(source).replace(/["']/g, ""))) continue;
          const value = entry.initializer;
          if (ts.isStringLiteral(value) && color.test(value.text) || /zIndex/.test(entry.name.getText(source)) && ts.isNumericLiteral(value)) report("inline-ui-literal", entry.getText(source));
        }
      }
    }
    if (ts.isCallExpression(node) && portalCalls.has(node.expression.getText(source)) && !portalOwners.has(file)) report("unowned-portal", node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
export function findingKey(finding) { return JSON.stringify([finding.file, finding.rule, finding.detail]); }
export function uiSourceFiles(directory = path.join(root, "src/app")) {
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(tsx?|css)$/.test(file)) files.push(file); } };
  walk(directory);
  return files.sort();
}
export function collectUiFindings(directory) {
  return uiSourceFiles(directory).flatMap(file => scanUiSource(path.relative(root, file).replaceAll(path.sep, "/"), fs.readFileSync(file, "utf8")));
}
export function checkUiInventory(files, surfaces) {
  const tracked = new Set(surfaces.map(surface => surface.path));
  return files.filter(file => file.endsWith(".tsx") && !tracked.has(file));
}
export function checkUiFindings(findings, exceptions) {
  const remaining = new Map(exceptions.map(entry => [findingKey(entry), entry.count]));
  const errors = [];
  for (const finding of findings) {
    const key = findingKey(finding), count = remaining.get(key) ?? 0;
    if (count > 0) remaining.set(key, count - 1); else errors.push(finding);
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkUiControls();
  const policy = JSON.parse(fs.readFileSync(path.join(root, "scripts/ui-exceptions.json"), "utf8"));
  for (const entry of policy.exceptions) if (!entry.owner || !entry.reason || !entry.reviewBy || !entry.surface) throw new Error(`Unowned UI exception: ${entry.file}`);
  const findings = collectUiFindings(), errors = checkUiFindings(findings, policy.exceptions);
  const inventory = JSON.parse(fs.readFileSync(path.join(root, "scripts/ui-surface-inventory.json"), "utf8"));
  for (const surface of inventory.surfaces) if (!surface.owner || !surface.batch || !fs.existsSync(path.join(root, surface.path))) throw new Error(`Stale or unowned UI surface: ${surface.path}`);
  const untracked = checkUiInventory(uiSourceFiles().map(file => path.relative(root, file).replaceAll(path.sep, "/")), inventory.surfaces);
  if (untracked.length) throw new Error(`UI inventory missing surfaces: ${untracked.join(", ")}. Run npm run ui:inventory and review owners.`);
  if (errors.length) { console.error(JSON.stringify(errors, null, 2)); process.exitCode = 1; }
  else console.log(`UI architecture: no new violations; ${findings.length} exact legacy declarations/controls tracked with named owners (not a global exemption).`);
}
