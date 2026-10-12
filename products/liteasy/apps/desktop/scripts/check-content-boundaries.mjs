import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** AST checks deliberately scoped to rich bodies and the one sanitizer owner, with executable negative fixtures. */
export function contentBoundaryViolations(source, fileName) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const errors = [];
  const markdownOwner = /features\/markdown\/(MarkdownContent|contentProfile)\.tsx?$/.test(fileName);
  const publicView = /features\/markdown\/ContentView\.tsx$/.test(fileName);
  const add = (node, reason) => errors.push(`${fileName}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${reason}`);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (["react-markdown", "rehype-raw", "rehype-sanitize"].includes(node.moduleSpecifier.text) && !markdownOwner && !node.importClause?.isTypeOnly && !(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every(item => item.isTypeOnly))) add(node, "富正文流水线必须归属 markdown owner");
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(ast) === "MarkdownContent" && !publicView) add(node, "请使用 typed ContentView");
      if (node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === "dangerouslySetInnerHTML") && /features\/(evidence|markdown)\//.test(fileName)) add(node, "禁止绕过共享净化");
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "blockquote" && node.children.some(child => ts.isJsxExpression(child) && child.expression && ts.isPropertyAccessExpression(child.expression) && ["quote", "text", "body", "content"].includes(child.expression.name.text))) add(node, "研究正文不能作为裸字符串显示");
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "slice" && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "text" && /features\/evidence\//.test(fileName)) add(node, "证据不得再次按字符截断富片段");
    ts.forEachChild(node, visit);
  }
  visit(ast); return errors;
}
export function checkContentBoundaries(root) {
  const errors = [];
  const visit = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.tsx?$/.test(file)) errors.push(...contentBoundaryViolations(readFileSync(file, "utf8"), relative(root, file).replaceAll("\\", "/")));
  } };
  visit(root); return errors;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkContentBoundaries(fileURLToPath(new URL("../src/app/", import.meta.url)));
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Content boundaries: shared renderer, sanitizer and evidence projection passed.");
}
