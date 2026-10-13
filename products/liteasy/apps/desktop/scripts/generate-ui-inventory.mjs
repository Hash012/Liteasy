import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const root = path.resolve("src/app");
const files = [];
function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) walk(file); else if (file.endsWith(".tsx")) files.push(file); } }
walk(root);
function batch(file) {
  if (/\/pdf\/|\/selection-lookup\//.test(file)) return "M1";
  if (/\/layout\/|\/dock\/|\/workspace\//.test(file)) return "M2";
  if (/\/assistant\/|\/agent-work\/|\/ai-workbench\//.test(file)) return "M3";
  if (/\/library\/|\/reading-library\/|\/notes\/|\/note-files\/|\/resource-|\/import\/|\/recommendations\//.test(file)) return "M4";
  if (/\/boards\/|\/thin-reading\/|\/paper-reading\/|\/artifacts\/|\/evidence\/|\/research-loop\/|\/document-export\/|\/visual|\/mermaid\/|\/citation-graph\/|\/intuition-graph\/|\/layered-reading\//.test(file)) return "M5";
  return "M6";
}
const surfaces = files.sort().map(file => {
  const text = fs.readFileSync(file, "utf8"), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const symbols = [], interactions = new Set(), styles = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name) symbols.push(node.name.text);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) { const tag = node.tagName.getText(source); if (/Dialog|Popover|Menu|Drawer|Overlay|Composer|^form$|^input$|^textarea$|^select$|^button$/.test(tag)) interactions.add(tag); }
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.endsWith(".css")) styles.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  }; visit(source);
  const migration = text.includes("productPrimitives") ? "product-primitives" : /@fluentui\/react-components/.test(text) ? "existing-Fluent-adapter" : "inherited-semantic-surface";
  return { path: path.relative(process.cwd(), file).replaceAll(path.sep, "/"), batch: batch(file), owner: `${batch(file)} surface owner / shared UI review`, symbols, interactions: [...interactions].sort(), styles, migration,
    disclosure: { contextualActions: text.includes("ContextualActions"), explicitDetails: text.includes("SourceDisclosure") || text.includes("<details"), commandMenu: interactions.has("MenuTrigger"), ownership: "Primary actions, active values and risk states remain host-owned; secondary controls use explicit disclosure", runtimeAcceptance: "Requires per-surface browser evidence; static inventory is not acceptance" }, themeOwner: "ApplicationThemeProvider + productPrimitives.css", retainedContracts: "Existing controller, storage, authorization, ContentView and ExportDocument ownership unchanged", reviewGate: "scripts/check-ui-boundaries.mjs exact AST/CSS exceptions; browser surface matrix", releaseReview: "QAU-10; current platform results recorded separately, migration marker is not visual acceptance" };
});
fs.writeFileSync("scripts/ui-surface-inventory.json", JSON.stringify({ schema: "liteasy.ui-surface-inventory/v1", batches: { M1: "Quick Ask, selection, lookup, annotations", M2: "Shell, navigation, tabs, status, docking", M3: "Assistant views, histories, composer, tasks", M4: "Libraries, assets, notes, metadata", M5: "Research, boards, content, evidence, export", M6: "Settings, connections, account, organization, extensions, help and shared adapters" }, surfaces }, null, 2) + "\n");
console.log(`Named UI inventory: ${surfaces.length} TSX entry files; ${surfaces.filter(surface => surface.interactions.length).length} interactive/overlay surfaces.`);
