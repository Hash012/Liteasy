import { compileStaticDiagrams } from "./staticDiagrams";
import { exportImageDimensions } from "./exportImage";
import katex from "katex";
import { parseResearchDocument } from "../markdown/researchParser";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { stageDataUrl, stageImage } from "../objects/objectAssets";
import { sha256, stableJson, walkDocument, defaultExportOptions, type DocumentNode, type ExportDocument, type ExportOptions, type ExportSource } from "./documentExport.types";

const tags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "a", "img", "br", "hr", "sup", "sub", "section", "div", "span", "dl", "dt", "dd"]);
export function researchDocumentNodes(markdown: string, idPrefix = "block"): { nodes: DocumentNode[]; diagnostics: ExportDocument["diagnostics"] } {
  const diagnostics: ExportDocument["diagnostics"] = [];
  let nextId = 0;
  const convert = (node: any): DocumentNode[] => {
    const id = `${idPrefix}-${++nextId}`;
    const source = node.position?.start?.offset !== undefined ? { start: node.position.start.offset, end: node.position.end.offset } : undefined;
    if (node.type === "text") return [{ id, type: "text", value: node.value, source }];
    if (node.type === "element" && typeof node.properties?.dataExportMath === "string") return [{ id, type: "math", value: node.properties.dataExportMath, properties: { display: Boolean(node.properties.dataExportDisplay) }, source }];
    const children = (node.children ?? []).flatMap(convert);
    if (node.properties?.dataExportFootnoteDefinition !== undefined || node.properties?.dataExportFootnoteReference !== undefined) return [{ id, type: "element", tag: "span", properties: { footnoteId: String(node.properties.dataExportFootnoteDefinition ?? node.properties.dataExportFootnoteReference), footnoteDefinition: node.properties.dataExportFootnoteDefinition !== undefined }, children, source }];
    if (node.type !== "element" || !tags.has(node.tagName)) {
      if (node.type === "element") diagnostics.push({ code: "unsupported_element", severity: "warning", nodeId: id, message: `不支持的 ${node.tagName} 结构已转为正文。` });
      return children;
    }
    const properties: NonNullable<DocumentNode["properties"]> = {};
    for (const key of ["href", "src", "alt", "title", "start", "colSpan", "rowSpan", "id", "scope", "headers", "className"]) {
      const value = node.properties?.[key];
      if (value !== undefined && (typeof value === "string" || typeof value === "number" || Array.isArray(value))) properties[key] = value;
    }
    if (node.tagName === "a" && typeof properties.href === "string" && !/^(?:https?:|mailto:|#)/i.test(properties.href)) {
      delete properties.href;
      diagnostics.push({ code: "local_link_text", severity: "warning", nodeId: id, message: "本地资源链接保留文字，离开 Liteasy 后不能直接定位。" });
    }
    return [{ id, type: "element", tag: node.tagName, properties, children, source }];
  };
  const tree = parseResearchDocument(markdown);
  for (const code of tree.exportLosses ?? []) diagnostics.push({ code, severity: "warning", message: "脚本、事件属性、自定义样式或危险链接已按安全规则移除；原始来源未修改。" });
  return { nodes: (tree.children ?? []).flatMap(convert), diagnostics };
}

export async function compileDocument(input: {
  title: string; markdown: string; options?: Partial<ExportOptions>; sources?: ExportSource[];
  sourceIdentity?: string; basePath?: string; assets?: AgentAssetService; signal?: AbortSignal;
  active?: () => boolean;
}): Promise<ExportDocument> {
  input = { ...input, sources: structuredClone(input.sources ?? []), options: structuredClone(input.options ?? {}) };
  const options = { ...defaultExportOptions, ...input.options };
  const check = () => { input.signal?.throwIfAborted(); if (input.active && !input.active()) throw new Error("账号或来源权限已变化，导出已中止。"); };
  check();
  if (!["full_saved", "selected_nodes", "current_subtree", "excerpt"].includes(options.scope) || !["references", "excerpts", "full_appendix"].includes(options.evidenceMode) || !["require_saved", "frozen_draft"].includes(options.draftPolicy)) throw new Error("导出范围或证据策略无效。");
  if (options.assetPolicy !== "local_only" || !["research-report/v1", "spatial-atlas/v1"].includes(options.profileId)) throw new Error("未注册的导出策略。");
  const document: ExportDocument = { version: "liteasy.export-document/v1", title: input.title, nodes: [], assets: [], diagnostics: [], sources: input.sources ?? [], sourceDigest: "", options };
  if (!document.sources.length) document.sources.push({ identity: input.sourceIdentity ?? "document", state: "legacy-unpinned", sha256: await sha256(input.markdown) });
  const parsed = researchDocumentNodes(input.markdown, (await sha256(input.markdown)).slice(0, 12));
  document.nodes = parsed.nodes;
  document.diagnostics.push(...parsed.diagnostics);
  const images: DocumentNode[] = [];
  walkDocument(document.nodes, node => { if (node.tag === "img") images.push(node); });
  let totalBytes = 0, totalPixels = 0;
  const resolved = new Map<string, string>();
  for (const node of images) {
    check();
    const source = String(node.properties?.src ?? "");
    try {
      if (!source || /^(?:https?:|blob:|file:|\/\/)/i.test(source) || source.startsWith("/") || source.startsWith("\\")) throw new Error("图片不在已授权本地资源中");
      let path = resolved.get(source);
      if (!path) {
        const image = source.startsWith("data:image/") ? await stageDataUrl(source) : await (async () => {
          if (!input.assets || !input.basePath) throw new Error("缺少图片读取权限");
          const images = await input.assets.resolveImages(source.startsWith("liteasy:") ? source : input.basePath,
            { signal: input.signal, ...(source.startsWith("liteasy:") ? {} : { relativePath: source }) });
          if (images.length !== 1) throw new Error("图片不存在或来源有歧义");
          return stageImage(Uint8Array.from(atob(images[0].base64), char => char.charCodeAt(0)), images[0].mediaType);
        })();
        if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mediaType)) throw new Error("图片格式尚不支持安全静态导出");
        const bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0));
        const dimensions = exportImageDimensions(bytes, image.mediaType);
        totalPixels += dimensions.width * dimensions.height;
        if (totalPixels > 100_000_000) throw new Error("附件总像素超过导出预算。");
        path = `assets/${image.sha256}.${image.mediaType.split("/")[1].replace("jpeg", "jpg")}`;
        if (!document.assets.some(asset => asset.path === path)) {
          totalBytes += bytes.length;
          if (totalBytes > 24 * 1024 * 1024) throw new Error("附件总大小超过 24 MiB");
          document.assets.push({ id: image.sha256, sha256: image.sha256, mediaType: image.mediaType, bytes, path });
        }
        resolved.set(source, path);
      }
      node.properties = { ...node.properties, src: path };
    } catch (error) {
      const budget = error instanceof Error && /超过|大小无效|尺寸无效/.test(error.message);
      node.type = "element"; node.tag = "p";
      node.children = [{ id: `${node.id}-missing`, type: "text", value: `图片缺失：${String(node.properties?.alt || "无图注")}（未读取到已授权本地图片）` }];
      node.properties = {};
      document.diagnostics.push({ code: budget ? "asset_budget_exceeded" : "missing_asset", severity: budget ? "error" : "warning", nodeId: node.id, message: budget ? "图片大小或像素超过导出预算，请缩减附件后重试。" : "图片未打包；保留图注并注明缺失，请检查来源权限。" });
    }
  }
  await compileStaticDiagrams(document, input.signal);
  if (document.assets.reduce((total, asset) => total + asset.bytes.length, 0) > 24 * 1024 * 1024) throw new Error("附件总大小超过 24 MiB，请拆分导出。");
  if (document.assets.reduce((total, asset) => { const image = exportImageDimensions(asset.bytes, asset.mediaType); return total + image.width * image.height; }, 0) > 100_000_000) throw new Error("附件总像素超过导出预算，请拆分导出。");
  check();
  walkDocument(document.nodes, node => {
    if (node.tag === "p") {
      const text = (item: DocumentNode): string => item.value ?? (item.children ?? []).map(text).join("");
      if (text(node).length > 1200) document.diagnostics.push({ code: "source_long_paragraph", severity: "warning", nodeId: node.id, message: "源内容含较长的单段正文；导出保留原段落，不自动改写或分段。如需重排，请先编辑并审阅来源。" });
    }
    if (node.type === "math" && (node.value?.length ?? 0) > 160) {
      node.properties = { ...node.properties, wide: true };
      document.diagnostics.push({ code: "wide_math_source", severity: "warning", nodeId: node.id, message: "此公式较长，纸张版使用可换行的完整 TeX 源码作为明确替代，避免裁剪或缩小；屏幕与 Markdown 保留原公式。" });
    }
    if (node.type === "math") { try { katex.renderToString(node.value ?? "", { output: "mathml", trust: false, maxExpand: 500, maxSize: 20, throwOnError: true }); }
      catch { document.diagnostics.push({ code: "math_source_fallback", severity: "warning", nodeId: node.id, message: "公式无法安全排版，保留完整 TeX 源码。" }); } }
  });
  document.sourceDigest = await sha256(stableJson({ sources: document.sources, assets: document.assets.filter(asset => asset.origin !== "generated").map(({ sha256, path }) => ({ sha256, path })) }));
  return document;
}
