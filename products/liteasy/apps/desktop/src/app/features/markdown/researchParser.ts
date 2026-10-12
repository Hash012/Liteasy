import remarkFrontmatter from "remark-frontmatter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import { researchContentPlugins } from "./contentProfile";

export const researchRemarkPlugins = [remarkGfm, remarkMath, remarkFrontmatter];
export const researchMarkdownParser = () => unified().use(remarkParse).use(researchRemarkPlugins);
/** Full export rejects an oversized structure; it never returns a shortened display preview. */
function assertFullStructure() {
  return (tree: any) => {
    let count = 0;
    const visit = (node: any, depth: number) => {
      if (++count > 30000 || depth > 64) throw new Error("文档结构超过导出限制，请拆分后导出；未生成截短文件。");
      for (const child of node.children ?? []) visit(child, depth + 1);
    };
    visit(tree, 0);
  };
}
function captureExportLosses() {
  return (tree: any, file: any) => {
    const issues: string[] = [];
    const imageReferences = new Set<string>();
    const linkReferences = new Set<string>();
    const collectReferences = (node: any) => {
      if (node.type === "imageReference") imageReferences.add(node.identifier);
      if (node.type === "linkReference") linkReferences.add(node.identifier);
      node.children?.forEach(collectReferences);
    };
    collectReferences(tree);
    const visit = (node: any) => {
      if (node.type === "html" && /<(?:script|iframe|object|svg)\b|\bon[a-z]+\s*=|\bstyle\s*=/i.test(node.value ?? "")) issues.push("unsafe_content_removed");
      const localImageDefinition = node.type === "definition" && imageReferences.has(node.identifier) && !linkReferences.has(node.identifier) && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(node.url ?? "");
      if (!localImageDefinition && (node.type === "link" || node.type === "definition") && /^(?:javascript|file|data):/i.test(node.url ?? "")) issues.push("unsafe_link_removed");
      node.children?.forEach(visit);
    };
    visit(tree); file.data.exportLosses = [...new Set(issues)];
  };
}
function preserveFootnotes() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "footnoteDefinition") { node.type = "blockquote"; node.data = { hName: "span", hProperties: { dataExportFootnoteDefinition: node.identifier } }; }
      else if (node.type === "footnoteReference") { node.type = "text"; node.value = ""; node.data = { hName: "span", hProperties: { dataExportFootnoteReference: node.identifier } }; }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
const mathElement = (_state: unknown, node: any): any => ({ type: "element", position: node.position, tagName: "span",
  properties: { dataExportMath: node.value, dataExportDisplay: node.type === "math" }, children: [] });
export function parseResearchDocument(markdown: string) {
  if (new TextEncoder().encode(markdown).length > 8 * 1024 * 1024) throw new Error("正文超过 8 MiB 导出限制，请拆分后重试。");
  const parser = researchMarkdownParser().use(assertFullStructure).use(captureExportLosses).use(preserveFootnotes).use(remarkRehype, {
    allowDangerousHtml: true, handlers: { math: mathElement, inlineMath: mathElement, code: (_state: unknown, node: any): any => ({ type: "element", tagName: "pre", properties: {}, position: node.position, children: [{ type: "element", tagName: "code", properties: node.lang ? { className: [`language-${node.lang}`] } : {}, children: [{ type: "text", value: node.value }] }] }), yaml: (_state: unknown, node: any): any => ({ type: "element", tagName: "pre", properties: {}, children: [{ type: "element", tagName: "code", properties: { className: ["language-yaml"] }, children: [{ type: "text", value: node.value }] }] }) },
  }).use(assertFullStructure).use(researchContentPlugins as any).use(assertFullStructure);
  const file = { value: markdown, data: {} as { exportLosses?: string[] } };
  const tree = parser.runSync(parser.parse(markdown), file) as any;
  tree.exportLosses = file.data.exportLosses ?? [];
  return tree;
}
