import { spatialAtlasHtml } from "./spatialAtlas";
import katex from "katex";
import type { DocumentNode, ExportDocument } from "./documentExport.types";

export const printCss = `
@page{size:A4;margin:20mm 20mm 22mm}
:root{color:#26383d;background:#fff;font-family:"Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif;font-size:11pt}
body{margin:0;line-height:1.6;overflow-wrap:anywhere}main{max-width:170mm;margin:auto}
h1,h2,h3,h4,h5,h6{color:#244f4c;line-height:1.28;break-after:avoid;page-break-after:avoid}
h1{font-size:24pt}h2{font-size:18pt;margin-top:18pt}h3{font-size:14pt}h4,h5,h6{font-size:12pt}
p{margin:0 0 6pt;orphans:2;widows:2}li{orphans:2;widows:2}
table{border-collapse:collapse;width:100%;font-size:9.5pt;table-layout:fixed;margin:10pt 0}
thead{display:table-header-group}td,th{vertical-align:top;padding:4pt 6pt;border-bottom:1px solid #d8e1de;overflow-wrap:anywhere}th{background:#f1f5f3;text-align:left}
caption{font-size:9pt;text-align:left;break-after:avoid}tr{break-inside:auto}pre{white-space:pre-wrap;overflow:visible;font-size:9pt;padding:8pt;border:1px solid #d8e1de;overflow-wrap:anywhere}
pre code{white-space:pre-wrap;font-family:Consolas,"Noto Sans Mono",monospace}blockquote{margin:8pt 0;padding-left:10pt;border-left:2px solid #83aca5}
img{max-width:100%;max-height:235mm;object-fit:contain}a{color:#244f4c;text-decoration:underline}math[display=block]{margin:8pt 0;max-width:100%}
.export-diagnostics{font-size:9pt;border-top:1px solid #d8e1de;margin-top:16pt}.export-meta{font-size:9pt;color:#536766}
@media screen{body{padding:20mm;max-width:210mm;margin:auto}}@media print{main{max-width:none}body{padding:0}}`;
export function escapeDocumentHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function bytesBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function documentNodeHtml(node: DocumentNode, document?: ExportDocument): string {
  if (node.type === "text") return escapeDocumentHtml(node.value ?? "");
  if (node.type === "math") {
    try { return katex.renderToString(node.value ?? "", { output: "mathml", displayMode: Boolean(node.properties?.display), trust: false, maxExpand: 500, maxSize: 20, throwOnError: true }); }
    catch { return `<code>${escapeDocumentHtml(node.value ?? "")}</code>`; }
  }
  if (node.properties?.footnoteId !== undefined) {
    const id = escapeDocumentHtml(String(node.properties.footnoteId));
    return node.properties.footnoteDefinition ? `<aside id="fn-${id}"><p>[${id}]</p>${(node.children ?? []).map(child => documentNodeHtml(child, document)).join("")}</aside>` : `<sup><a href="#fn-${id}">[${id}]</a></sup>`;
  }
  const tag = node.tag ?? "span";
  const properties = { ...node.properties };
  if (tag === "img" && document) {
    const asset = document.assets.find(asset => asset.path === properties.src);
    if (!asset) return `<p>图片缺失：${escapeDocumentHtml(String(properties.alt ?? ""))}</p>`;
    properties.src = `data:${asset.mediaType};base64,${bytesBase64(asset.bytes)}`;
  }
  const names: Record<string, string> = { colSpan: "colspan", rowSpan: "rowspan", className: "class" };
  const attributes = Object.entries(properties).filter(([key]) => ["href", "src", "alt", "title", "start", "colSpan", "rowSpan", "id", "scope", "headers", "className"].includes(key)).map(([key, value]) => ` ${names[key] ?? key}="${escapeDocumentHtml(Array.isArray(value) ? value.join(" ") : String(value))}"`).join("");
  return `<${tag}${attributes}>${["img", "br", "hr"].includes(tag) ? "" : `${(node.children ?? []).map(child => documentNodeHtml(child, document)).join("")}</${tag}>`}`;
}
export function renderDocumentHtml(document: ExportDocument) {
  const atlas = document.spatialAtlas ? spatialAtlasHtml(document.spatialAtlas, document) : "";
  const atlasCss = document.spatialAtlas ? `@page atlas{size:${document.options.paperSize ?? "A4"} ${document.options.orientation ?? "portrait"};margin:20mm}.atlas-page{page:atlas;break-after:page}.atlas-page p{font-size:9pt}.atlas-viewport{position:relative;overflow:hidden}.atlas-viewport>svg{position:absolute;inset:0}.atlas-card{position:absolute;overflow:hidden;border:1px solid #bbc9c5;background:white;padding:6px;box-sizing:border-box;font-size:14px;line-height:1.6}.atlas-card h1,.atlas-card h2,.atlas-card h3{font-size:16px}.atlas-card>strong{display:block;font-size:12px}` : "";
  const issues = document.diagnostics.length ? `<aside class="export-diagnostics"><h2>导出说明</h2><ul>${document.diagnostics.map(issue => `<li>${escapeDocumentHtml(issue.message)}</li>`).join("")}</ul></aside>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; script-src 'none'"><title>${escapeDocumentHtml(document.title)}</title><style>${printCss}${atlasCss}</style></head><body>${atlas}<main>${document.nodes.map(node => documentNodeHtml(node, document)).join("\n")}${issues}</main></body></html>`;
}
