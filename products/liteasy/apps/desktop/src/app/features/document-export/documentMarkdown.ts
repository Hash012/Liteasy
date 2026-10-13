import { zip, strToU8 } from "fflate";
import { documentNodeHtml } from "./documentHtml";
import { sha256 } from "./documentExport.types";
import type { DocumentNode, ExportDocument } from "./documentExport.types";
const literal = (value: string) => value.replace(/([\\`*[\]<>!|])/g, "\\$1");
const text = (node: DocumentNode): string => (node.value ?? (node.children ?? []).map(text).join(""));
export function documentNodeMarkdown(node: DocumentNode): string {
  const content = () => (node.children ?? []).map(documentNodeMarkdown).join("");
  if (node.type === "text") return literal(node.value ?? "");
  if (node.type === "math") return node.properties?.display ? `\n$$\n${node.value}\n$$\n\n` : `$${node.value}$`;
  const value = content();
  if (node.properties?.footnoteId !== undefined) return node.properties.footnoteDefinition ? `[^${node.properties.footnoteId}]: ${value.trim().split("\n").join("\n    ")}\n\n` : `[^${node.properties.footnoteId}]`;
  if (/^h[1-6]$/.test(node.tag ?? "")) return `${"#".repeat(Number(node.tag![1]))} ${value}\n\n`;
  switch (node.tag) {
    case "p": return `${value}\n\n`;
    case "br": return "  \n";
    case "hr": return "\n---\n\n";
    case "strong": return `**${value}**`;
    case "em": return `*${value}*`;
    case "del": return `~~${value}~~`;
    case "pre": {
      const code = node.children?.find(child => child.tag === "code");
      const raw = text(code ?? node);
      const fence = "`".repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(match => match[0].length + 1)));
      const classes = code?.properties?.className;
      const language = (Array.isArray(classes) ? classes : []).find(value => value.startsWith("language-"))?.slice(9) ?? "";
      return `${fence}${language}\n${raw}\n${fence}\n\n`;
    }
    case "code": { const raw = text(node); const fence = "`".repeat(Math.max(1, ...[...raw.matchAll(/`+/g)].map(match => match[0].length + 1))); const padding = raw.startsWith("`") || raw.endsWith("`") ? " " : ""; return `${fence}${padding}${raw}${padding}${fence}`; }
    case "blockquote": {
      const quoted = (node.children ?? []).filter(child => child.type !== "text" || child.value?.trim()).map(documentNodeMarkdown).join("").trimEnd();
      return `${quoted.split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
    }
    case "ul": case "ol": return (node.children ?? []).filter(child => child.tag === "li").map((child, index) => {
      const marker = node.tag === "ol" ? `${Number(node.properties?.start ?? 1) + index}. ` : "- ";
      const lines = documentNodeMarkdown(child).trimEnd().split("\n");
      return marker + lines[0] + lines.slice(1).map(line => `\n${" ".repeat(marker.length)}${line}`).join("") + "\n";
    }).join("") + "\n";
    case "li": return value;
    case "a": return node.properties?.href ? `[${value}](${String(node.properties.href).replace(/[()\s]/g, char => encodeURIComponent(char))})` : value;
    case "img": return `![${literal(String(node.properties?.alt ?? "图片"))}](${node.properties?.src})`;
    case "table": {
      const rows = (node.children ?? []).flatMap(child => child.tag === "tr" ? [child] : (child.children ?? []).filter(row => row.tag === "tr"));
      const cells = rows.map(row => (row.children ?? []).filter(cell => cell.tag === "td" || cell.tag === "th"));
      if (cells.flat().some(cell => Number(cell.properties?.colSpan ?? 1) > 1 || Number(cell.properties?.rowSpan ?? 1) > 1)) return `${documentNodeHtml(node)}\n\n`;
      if (!cells.length) return "";
      const width = Math.max(...cells.map(row => row.length));
      const line = (row: DocumentNode[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ? documentNodeMarkdown(row[index]).trim().replace(/\n/g, "<br>") : "").join(" | ")} |\n`;
      const caption = node.children?.find(child => child.tag === "caption");
      return (caption ? documentNodeMarkdown(caption) + "\n\n" : "") + line(cells[0]) + `| ${Array(width).fill("---").join(" | ")} |\n` + cells.slice(1).map(line).join("") + "\n";
    }
    default: return value;
  }
}
export function renderDocumentMarkdown(document: ExportDocument) {
  return document.nodes.map(documentNodeMarkdown).join("").trimEnd() + (document.diagnostics.length ? `\n\n## 导出说明\n\n${document.diagnostics.map(issue => `- ${literal(issue.message)}`).join("\n")}\n` : "\n");
}
export async function renderMarkdownPackage(document: ExportDocument) {
  const markdown = renderDocumentMarkdown(document);
  if (!document.assets.length && !document.attachments?.length) return { bytes: strToU8(markdown), extension: "md", mimeType: "text/markdown;charset=utf-8" };
  const files: Record<string, Uint8Array> = { "document.md": strToU8(markdown), "manifest.json": strToU8(JSON.stringify({ version: "liteasy.export-package/v1", sourceDigest: document.sourceDigest, profileId: document.options.profileId, assets: document.assets.map(({ path, sha256, mediaType, bytes }) => ({ path, sha256, mediaType, byteLength: bytes.length })), diagnostics: document.diagnostics }, null, 2) + "\n"), "README.md": strToU8("请解压整个压缩包，保持 document.md 与 assets/ 的相对位置。数学、脚注和合并表格需要 research Markdown 兼容阅读器。\n") };
  for (const asset of document.assets) files[asset.path] = asset.bytes;
  for (const attachment of document.attachments ?? []) {
    if (!/^assets\/research\/[a-z0-9-]+\.(json|txt)$/.test(attachment.path) || files[attachment.path]) throw new Error("研究附件路径无效。");
    if (await sha256(attachment.bytes) !== attachment.sha256) throw new Error("研究附件哈希核验失败。");
    files[attachment.path] = attachment.bytes;
  }
  if (document.attachments?.length) {
    files["README.md"] = strToU8(new TextDecoder().decode(files["README.md"]) + "\n原始研究附件（请按 replay-instructions.txt 独立重放；测量与科学支持分开判断）：\n\n" + document.attachments.map(item => `- [${item.path}](${item.path})`).join("\n") + "\n");
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.attachments = document.attachments.map(({ path, sha256, mediaType, bytes }) => ({ path, sha256, mediaType, byteLength: bytes.length }));
    files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n");
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)));
  return { bytes, extension: "zip", mimeType: "application/zip" };
}
