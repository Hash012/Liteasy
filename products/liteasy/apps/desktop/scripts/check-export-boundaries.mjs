import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Export the detector so negative fixtures exercise the exact production gate. */
export function exportBoundaryViolations(path, source) {
  const errors = [], tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (node, message) => errors.push(`${path}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${message}`);
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.text;
      if (/document-export\//.test(path) && /^(remark-parse|rehype-sanitize|rehype-raw|html2canvas|html2pdf)/.test(name)) report(node, "导出必须复用 research parser/profile；禁止整页截图后端");
      if (/createArtifactExportPayload|createCompatibilityArtifactPdf|createCompatibilityImagePdf/.test(node.importClause?.getText(tree) ?? "") && !/compatibility/.test(path)) report(node, "兼容图片 PDF 不能进入报告默认链路");
      if (/^(node:|playwright|@playwright)/.test(name)) report(node, "浏览器导出不能打包 Node/Playwright runtime");
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(tree);
      if (/^(fetch|eval|html2canvas|XMLHttpRequest|axios\.)/.test(callee)) report(node, "导出不能执行正文脚本或默认网络读取");
      if (/document\.(querySelector|querySelectorAll|getElementById)/.test(callee)) report(node, "正文必须来自固定来源模型，不能读取当前 DOM");
    }
    if (ts.isPropertyAccessExpression(node) && /^(tab|artifact)$/.test(node.expression.getText(tree)) && /^(type|artifactType)$/.test(node.name.text) && /document(?:Html|Markdown|Docx)\.ts$/.test(path)) report(node, "格式序列化器不得包含资产类型 switch");
    ts.forEachChild(node, visit);
  };
  visit(tree); return errors;
}
export function checkExportBoundaries(root) {
  const directory = resolve(root, "src/app/features/document-export");
  const paths = readdirSync(directory).filter(path => /\.tsx?$/.test(path)).map(path => resolve(directory, path));
  paths.push(resolve(root, "src/app/controllers/useArtifactExportController.ts"));
  return paths.flatMap(path => exportBoundaryViolations(relative(root, path), readFileSync(path, "utf8")));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkExportBoundaries(resolve(fileURLToPath(new URL("..", import.meta.url))));
  if (errors.length) { process.stderr.write(errors.join("\n") + "\n"); process.exitCode = 1; }
  else process.stdout.write("Export boundaries passed.\n");
}
