import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ArtifactExportPayload } from "../artifacts/artifactExport.types";
import { renderDocumentHtml, bytesBase64 } from "./documentHtml";
import { renderMarkdownPackage } from "./documentMarkdown";
import { documentFormats, safeDocumentStem, sha256, stableJson, walkDocument, type DocumentFormat, type ExportDocument, type ExportReceipt } from "./documentExport.types";

export async function renderExportDocument(document: ExportDocument, format: DocumentFormat, signal?: AbortSignal): Promise<ArtifactExportPayload> {
  signal?.throwIfAborted();
  if (!Object.prototype.hasOwnProperty.call(documentFormats, format)) throw new Error("未注册的导出格式。");
  if (document.diagnostics.some(issue => issue.severity === "error")) throw new Error("文档预检失败，请修复导出说明中的问题。");
  if (document.diagnostics.length && !document.options.acceptDegradations) throw new Error("文档包含缺失资源或格式降级，请先确认导出说明。");
  if (document.spatialAtlas && !["pdf", "html"].includes(format)) throw new Error("空间图集仅支持 PDF/HTML；Markdown/DOCX 请选择阅读报告。" );
  const requestId = crypto.randomUUID();
  let bytes: Uint8Array, mimeType = documentFormats[format].mimeType, extension = documentFormats[format].extension;
  let renderer = "liteasy-static-document/v1";
  if (format === "markdown") {
    const result = await renderMarkdownPackage(document);
    bytes = result.bytes; mimeType = result.mimeType; extension = result.extension;
  } else if (format === "html") bytes = new TextEncoder().encode(renderDocumentHtml(document));
  else if (format === "docx") {
    const { renderDocumentDocx } = await import("./documentDocx");
    bytes = await renderDocumentDocx(document); renderer = "docx/9.5.1";
  } else {
    if (!isTauri()) throw new Error("浏览器 PDF 请使用系统打印；无法确认后台生成或保存。");
    if (!await invoke<boolean>("document_pdf_capability")) throw new Error("此平台尚不支持后台 PDF，请使用系统打印或 HTML/DOCX。");
    signal?.throwIfAborted();
    const cancel = () => { void invoke("cancel_document_pdf", { requestId }).catch(() => undefined); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await invoke<{ content: string; renderer: string }>("render_document_pdf", { requestId, html: renderDocumentHtml(document) });
      bytes = Uint8Array.from(atob(result.content), char => char.charCodeAt(0)); renderer = result.renderer;
    } finally { signal?.removeEventListener("abort", cancel); }
    signal?.throwIfAborted();
    // Validate the actual bytes with the application's PDF.js engine, not a file header alone.
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const parsed = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    try {
      if (!parsed.numPages || parsed.numPages > 300) throw new Error("PDF 页数超过导出预算，请拆分文档。");
      let content = "";
      for (let page = 1; page <= parsed.numPages; page++) {
        signal?.throwIfAborted();
        content += (await (await parsed.getPage(page)).getTextContent()).items.map(item => "str" in item ? item.str : "").join("");
      }
      const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "");
      const expected: string[] = [];
      walkDocument(document.nodes, node => { if (node.type === "text" && node.value?.trim()) expected.push(node.value); });
      const searchable = normalize(content);
      if (expected.some(value => normalize(value).length > 0 && !searchable.includes(normalize(value)))) throw new Error("PDF 正文核验失败（缺字或内容未完整排版），未发布文件。请检查字体或导出 HTML/DOCX。");
    } finally { await parsed.destroy(); }
  }
  signal?.throwIfAborted();
  const fontManifest = "system-fonts/unverified";
  const renderKey = await sha256(stableJson({ sourceDigest: document.sourceDigest, format, profile: document.options, renderer, fontManifest, nodes: document.nodes, assets: document.assets.map(asset => asset.sha256) }));
  const receipt: ExportReceipt = { renderKey, fontManifest, version: "liteasy.export-receipt/v1", requestId, sourceDigest: document.sourceDigest, profileId: document.options.profileId, sources: document.sources, diagnostics: document.diagnostics, mimeType, byteLength: bytes.length, sha256: await sha256(bytes), renderer };
  return { artifactId: document.sources[0]?.identity ?? requestId, title: document.title, format,
    content: bytesBase64(bytes), contentEncoding: "base64", fileName: `${safeDocumentStem(document.title)}.${extension}`, mimeType, container: extension === "zip" ? "zip" : undefined, receipt, scopeId: document.scopeId, sessionGeneration: document.sessionGeneration, protectedPaths: document.protectedPaths };
}
