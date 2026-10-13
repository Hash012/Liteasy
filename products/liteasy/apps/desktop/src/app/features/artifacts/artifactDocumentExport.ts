import { researchMarkdownParser } from "../markdown/researchParser";
import { documentFormats } from "../document-export/documentExport.types";
import { researchDocumentNodes } from "../document-export/documentCompiler";
import { documentNodeMarkdown } from "../document-export/documentMarkdown";
import { documentNodeHtml, printCss } from "../document-export/documentHtml";
import type { ExportOptions } from "../document-export/documentExport.types";
import { formatPaperAnchorText, type PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";
import { paperAnchorsForArtifact } from "../paper-anchors/paperAnchorAdapters";
import type { ArtifactOutlineNode, ArtifactTab, ArtifactType } from "./artifact.types";
import type {
  ArtifactDocumentFormat,
  ArtifactExportPayload
} from "./artifactExport.types";
import type { VisualizationArtifactV1 } from "../visualization/visualizationArtifact.types";
import type { MineruFigure } from "../import/import.types";
import type { ThinReadingEvidenceSpan, ThinReadingFigureRecommendation } from "../thin-reading/thinReading.types";

export type { ArtifactDocumentFormat, ArtifactExportPayload } from "./artifactExport.types";

const artifactTypeLabels: Record<ArtifactType, string> = {
  comparison_table: "文献对比",
  layered_graph: "分层关系图",
  mindmap: "思维导图",
  ppt: "演示文稿",
  skill_doc: "Skill 文档",
  thin_reading: "薄读",
  tree: "树形分析"
};

const maximumMarkdownEvidenceQuoteCharacters = 600;

function cleanExportText(value: string, anchors: readonly PaperAnchorEntity[] = []) {
  return formatPaperAnchorText(value, anchors)
    .replace(/\s+([，。；：,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function removeInternalEvidenceIds(value: string, anchors: readonly PaperAnchorEntity[] = []) {
  // Match the screen's text-node formatter. Code, math, URLs and whitespace remain verbatim.
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }) => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (node.type === "text" && start !== undefined && end !== undefined) {
      const original = value.slice(start, end), text = formatPaperAnchorText(original, anchors);
      if (text !== original) edits.push({ start, end, text });
    }
    node.children?.forEach(child => visit(child as Parameters<typeof visit>[0]));
  };
  visit(researchMarkdownParser().parse(value));
  for (const edit of edits.sort((a, b) => b.start - a.start)) value = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return value;
}

function safeMarkdownText(value: string, anchors: readonly PaperAnchorEntity[] = []) {
  return cleanExportText(value, anchors)
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`[\]!()*])/g, "\\$1")
    .replace(/\|/g, "\\|");
}

function compactMarkdownEvidenceQuote(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximumMarkdownEvidenceQuoteCharacters) {
    return normalized;
  }
  return `${normalized.slice(0, maximumMarkdownEvidenceQuoteCharacters)}…（证据摘录；可选择完整证据附录）`;
}

function exportedEvidenceIds(ids: readonly string[]) {
  return ids.filter((id) => /^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(id));
}

function visualizationToMarkdown(visualizations: readonly VisualizationArtifactV1[], anchors: readonly PaperAnchorEntity[]) {
  if (!visualizations.length) return "";
  const lines: string[] = ["## 生成可视化", ""];
  visualizations.forEach((artifact, index) => {
    const source = artifact.modality === "source_figure" && artifact.spec.modality === "source_figure"
      ? artifact.spec.payload
      : undefined;
    const summary = safeMarkdownText(artifact.accessibility.summary);
    lines.push(`### ${source ? "论文原图" : "生成可视化"}${summary ? `：${summary}` : ""}`, "");
    if (!source) {
      lines.push(`- 类型：${safeMarkdownText(artifact.modality)}`);
      artifact.semanticObjects.forEach((object) => {
        const ids = exportedEvidenceIds(object.evidenceClaimIds.flatMap((claimId) =>
          artifact.evidenceBindings.find((binding) => binding.claimId === claimId)?.evidenceIds ?? []
        ));
        lines.push(`- 对象：${safeMarkdownText(object.label)}（${safeMarkdownText(object.kind)}，${safeMarkdownText(object.objectId)}）${ids.length ? `；证据：${ids.join("、")}` : ""}`);
      });
    } else {
      lines.push(`- 图：${safeMarkdownText(source.sourceFigureId)}`);
      lines.push(`- 来源：${safeMarkdownText(anchors.find((anchor) => anchor.source.paperId === source.paperId)?.presentation.title ?? "引用文献")} · 第 ${source.page} 页`);
      lines.push(`- 图注：${safeMarkdownText(source.caption)}`);
      if (source.regions.length) {
        lines.push("", "| 区域 | x | y | width | height | 论文出处 |", "| --- | ---: | ---: | ---: | ---: | --- |");
        source.regions.forEach((region) => {
          const ids = exportedEvidenceIds(region.evidenceIds);
          const { x, y, width, height } = region.bbox;
          lines.push(`| ${safeMarkdownText(region.id)} | ${x} | ${y} | ${width} | ${height} | ${ids.join("、")} |`);
        });
      }
    }
    if (index < visualizations.length - 1) lines.push("");
  });
  return lines.join("\n");
}

function sourceFiguresToMarkdown(figures: readonly MineruFigure[], tab: ArtifactTab, document: NonNullable<ArtifactTab["thinReadingDocument"]>) {
  if (!figures.length) return "";
  const figureBindings: Array<{ recommendation: ThinReadingFigureRecommendation; spans: readonly ThinReadingEvidenceSpan[] }> = Object.values(document.nodes).flatMap((node) => {
    const spans = node.evidence.paperEvidenceSpans ?? [];
    return (node.evidence.recommendedFigures ?? []).map((recommendation: ThinReadingFigureRecommendation) => ({ recommendation, spans }));
  });
  const lines = ["## 论文原图", ""];
  const exported = figures.flatMap((figure) => {
    const bindings = figureBindings.filter(({ recommendation }) => recommendation.figureId === figure.id);
    if (bindings.length !== 1) return [];
    const { recommendation, spans } = bindings[0]!;
    const recommendationEvidenceIds = [...new Set(recommendation.evidenceIds)];
    if (!recommendationEvidenceIds.length) return [];
    const evidenceMatches = recommendationEvidenceIds.map((evidenceId) => spans.filter((span) =>
      span.id === evidenceId && span.page === figure.page
    ));
    // Every recommendation ID must anchor this figure to the same page and paper.
    if (evidenceMatches.some((matches) => !matches.length)) return [];
    const candidates = evidenceMatches.flat();
    const paperIds = [...new Set(candidates.map((span) => span.paperId))];
    if (paperIds.length !== 1) return [];
    return [{ figure, paperId: paperIds[0]!, recommendation }];
  });
  exported.forEach(({ figure, paperId, recommendation }, index) => {
    const caption = figure.analysis?.title ?? figure.alt;
    const evidenceIds = exportedEvidenceIds(recommendation.evidenceIds);
    lines.push(`### ${safeMarkdownText(caption)}`, "");
    lines.push(`- 图：${safeMarkdownText(figure.id)}`);
    lines.push(`- 来源：${safeMarkdownText(tab.papers?.find((paper) => paper.id === paperId)?.title ?? "引用文献")} · 第 ${figure.page} 页`);
    lines.push(`- 图注：${safeMarkdownText(caption)}`);
    if (figure.dataUrl) lines.push("", `![${safeMarkdownText(caption)}](${figure.dataUrl})`, "");
    if (evidenceIds.length) {
      lines.push(`- 论文出处：${evidenceIds.join("、")}`);
    }
    if (index < exported.length - 1) lines.push("");
  });
  return exported.length ? lines.join("\n") : "";
}

function safeFileStem(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || "Liteasy-产物";
}

function outlineToMarkdown(nodes: readonly ArtifactOutlineNode[], anchors: readonly PaperAnchorEntity[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const byParent = new Map<string | undefined, ArtifactOutlineNode[]>();
  nodes.forEach((node) => {
    const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : undefined;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(node);
    byParent.set(parentId, siblings);
  });
  const lines: string[] = [];
  const visit = (node: ArtifactOutlineNode, depth: number, path: ReadonlySet<string>) => {
    if (path.has(node.id)) return;
    const evidenceCount = node.evidenceIds?.length ?? 0;
    lines.push(`${"  ".repeat(depth)}- ${safeMarkdownText(node.label, anchors)}${evidenceCount ? `（${evidenceCount} 条证据）` : ""}`);
    const nextPath = new Set(path).add(node.id);
    (byParent.get(node.id) ?? []).forEach((child) => visit(child, depth + 1, nextPath));
  };
  (byParent.get(undefined) ?? []).forEach((root) => visit(root, 0, new Set()));
  return lines.join("\n");
}

function thinReadingToMarkdown(tab: ArtifactTab, anchors: readonly PaperAnchorEntity[], options: Partial<ExportOptions> = {}) {
  const document = tab.thinReadingDocument;
  if (!document) return { markdown: "薄读内容缺失。", isV2: false };
  const lines: string[] = [];
  const visited = new Set<string>();
  const exportedEvidenceSpanIds = new Set<string>();
  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    const node = document.nodes[nodeId];
    if (!node) return;
    visited.add(nodeId);
    const headingLevel = Math.min(6, node.depth + 2);
    const safeText = (value: string) => document.version === "liteasy.thin-reading/v2"
      ? safeMarkdownText(value, anchors) : cleanExportText(value, anchors);
    lines.push(`${"#".repeat(headingLevel)} ${safeMarkdownText(node.title, anchors)}`, "", removeInternalEvidenceIds(node.summary, anchors), "");
    const legacyEvidence = document.version === "liteasy.thin-reading/v1"
      ? document.nodes[nodeId]?.evidence
      : undefined;
    if (legacyEvidence?.mermaid) {
      lines.push("```mermaid", legacyEvidence.mermaid.trim(), "```", "");
    }
    if (legacyEvidence?.interactiveDemo) {
      lines.push(`#### ${legacyEvidence.interactiveDemo.title}`, "", legacyEvidence.interactiveDemo.description, "", "```html", legacyEvidence.interactiveDemo.html.trim(), "```", "");
    }
    const unexportedEvidence = (node.evidence.paperEvidenceSpans ?? []).filter((evidence) => {
      if (exportedEvidenceSpanIds.has(evidence.id)) return false;
      exportedEvidenceSpanIds.add(evidence.id);
      return true;
    });
    if (unexportedEvidence.length && options.evidenceMode === "references") {
      lines.push("**来源索引**", "", ...unexportedEvidence.map(evidence => `- ${safeMarkdownText(tab.papers?.find(paper => paper.id === evidence.paperId)?.title ?? "引用文献")} · 第 ${evidence.page ?? "?"} 页`), "");
    }
    if (unexportedEvidence.length && options.evidenceMode !== "references") {
      lines.push("**论文证据**", "");
      unexportedEvidence.forEach((evidence) => {
        const quote = options.evidenceMode === "full_appendix"
          ? formatPaperAnchorText(evidence.quote, anchors).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]<>!|])/g, "\\$1")
          : safeText(compactMarkdownEvidenceQuote(evidence.quote));
        lines.push(`> 第 ${evidence.page ?? "?"} 页：${quote.split(/\r?\n/).join("\n> ")}`, "");
      });
    }
    if (options.scope !== "selected_nodes") node.childIds.forEach(visit);
  };
  if (options.scope === "selected_nodes" || options.scope === "current_subtree") {
    if (!options.nodeIds?.length || options.nodeIds.some(id => !document.nodes[id])) throw new Error("请选择有效的薄读节点。");
    options.nodeIds.forEach(visit);
  } else {
    visit(document.rootNodeId);
    Object.keys(document.nodes).forEach(visit);
  }
  if (document.version === "liteasy.thin-reading/v2") {
    const visuals = [...visited].flatMap(id => document.nodes[id].visualizations);
    const visual = visualizationToMarkdown(visuals, anchors);
    if (visual) lines.push("", visual);
    const sourceFigures = sourceFiguresToMarkdown(tab.figures ?? [], tab, { ...document, nodes: Object.fromEntries([...visited].map(id => [id, document.nodes[id]])) } as typeof document);
    if (sourceFigures) lines.push("", sourceFigures);
    return { markdown: lines.join("\n").trim(), isV2: true };
  }
  return { markdown: lines.join("\n").trim(), isV2: false };
}

export function createArtifactSourceMarkdown(tab: ArtifactTab, options: Partial<ExportOptions> & { includeExportedAt?: boolean } = {}) {
  const anchors = paperAnchorsForArtifact(tab);
  if (tab.type === "skill_doc") return `${removeInternalEvidenceIds(tab.markdown?.trim() || `# ${tab.title}`, anchors)}\n`;

  const lines = [
    `# ${safeMarkdownText(tab.title)}`,
    "",
    `> 产物类型：${artifactTypeLabels[tab.type]}`,
    ...(options.includeExportedAt === false ? [] : [`> 导出时间：${new Date().toLocaleString("zh-CN")}`])
  ];
  if (tab.papers?.length) {
    lines.push(`> 来源论文：${tab.papers.map((paper) => safeMarkdownText(paper.title)).join("；")}`);
  }
  lines.push("");

  let isV2ThinReading = false;
  if (tab.type === "thin_reading") {
    const thinReadingMarkdown = thinReadingToMarkdown(tab, anchors, options);
    lines.push(thinReadingMarkdown.markdown);
    if ((!options.scope || options.scope === "full_saved") && tab.answer?.trim()) lines.push("", "## Agent 分析", "", removeInternalEvidenceIds(tab.answer, anchors));
    isV2ThinReading = thinReadingMarkdown.isV2;
  } else {
    const outline = tab.outlineNodes?.length
      ? outlineToMarkdown(tab.outlineNodes, anchors)
      : removeInternalEvidenceIds(tab.outlineMarkdown ?? "", anchors);
    if (outline) lines.push("## 结构化内容", "", outline, "");
    if (tab.answer?.trim()) lines.push("## Agent 分析", "", removeInternalEvidenceIds(tab.answer, anchors), "");
    if (!outline && !tab.answer?.trim() && tab.preview) {
      lines.push("## 结构化内容", "", `- ${tab.preview.rootLabel}`, ...tab.preview.nodes.map((node) => `  - ${node}`), "");
    }
  }

  if (tab.analysis?.evidence.length && !isV2ThinReading && (!options.scope || options.scope === "full_saved")) {
    lines.push("## 证据索引", "");
    tab.analysis.evidence.forEach((evidence, index) => {
      lines.push(`${index + 1}. **${safeMarkdownText(evidence.paperTitle)} · 第 ${evidence.page} 页**`, `   > ${safeMarkdownText(evidence.quote)}`, "");
    });
  }
  const markdown = lines.join("\n").trim();
  const exportAnchors = anchors.map((anchor) => ({
    ...anchor,
    presentation: {
      ...anchor.presentation,
      title: safeMarkdownText(anchor.presentation.title),
      location: safeMarkdownText(anchor.presentation.location),
    },
  }));
  return `${removeInternalEvidenceIds(markdown, exportAnchors)}\n`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createArtifactMarkdown(tab: ArtifactTab, options: { includeExportedAt?: boolean } = {}) {
  return researchDocumentNodes(createArtifactSourceMarkdown(tab, options)).nodes.map(documentNodeMarkdown).join("").trimEnd() + "\n";
}

export function artifactMarkdownToHtml(markdown: string) {
  return researchDocumentNodes(markdown).nodes.map(node => documentNodeHtml(node)).join("\n");
}

export function createArtifactHtml(tab: ArtifactTab) {
  const markdown = createArtifactMarkdown(tab);
  const title = escapeHtml(tab.title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${printCss}</style>
</head>
<body>${artifactMarkdownToHtml(markdown)}</body>
</html>`;
}

function downloadBlob(filename: string, content: string | Uint8Array, mimeType: string) {
  const blobContent: BlobPart = content instanceof Uint8Array
    ? new Uint8Array(content).buffer
    : content;
  const blob = new Blob([blobContent], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const pdfPage = { height: 1754, width: 1240 };
const pdfMargin = 100;
const pdfTextColor = "#26383d";
const pdfFont = 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif';

type PdfCanvasPage = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  cursorY: number;
};

function wrapPdfText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const character of value) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(value: Uint8Array) {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...value.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

function combinePdfBytes(chunks: readonly Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

export function createCompatibilityImagePdf(pageImages: readonly Uint8Array[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const appendText = (value: string) => {
    const bytes = encoder.encode(value);
    chunks.push(bytes);
    length += bytes.length;
  };
  const appendBytes = (value: Uint8Array) => {
    chunks.push(value);
    length += value.length;
  };
  const addObject = (objectNumber: number, content: string | Uint8Array) => {
    offsets[objectNumber] = length;
    appendText(`${objectNumber} 0 obj\n`);
    if (typeof content === "string") appendText(content);
    else appendBytes(content);
    appendText("\nendobj\n");
  };
  const pageObjectNumbers = pageImages.map((_, index) => 3 + index * 3);

  appendText("%PDF-1.7\n%Liteasy\n");
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageImages.length} >>`);
  pageImages.forEach((image, index) => {
    const pageObject = pageObjectNumbers[index];
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const content = "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ";
    addObject(pageObject, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    addObject(contentObject, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
    offsets[imageObject] = length;
    appendText(`${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pdfPage.width} /Height ${pdfPage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
    appendBytes(image);
    appendText("\nendstream\nendobj\n");
  });
  const xrefOffset = length;
  const objectCount = 2 + pageImages.length * 3;
  appendText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let number = 1; number <= objectCount; number += 1) {
    appendText(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return combinePdfBytes(chunks);
}

/** Legacy image PDF: no searchable body text. Never the report service default. */
export function createCompatibilityArtifactPdf(tab: ArtifactTab) {
  const markdown = createArtifactMarkdown(tab);
  const pages: PdfCanvasPage[] = [];
  let page: PdfCanvasPage | undefined;
  const startPage = () => {
    const canvas = document.createElement("canvas");
    canvas.width = pdfPage.width;
    canvas.height = pdfPage.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境不支持内部 PDF 导出。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    page = { canvas, context, cursorY: pdfMargin };
    pages.push(page);
    return page;
  };
  const getPage = (height: number) => {
    if (!page || page.cursorY + height > pdfPage.height - pdfMargin) return startPage();
    return page;
  };
  const drawBlock = (value: string, options: { color?: string; fontSize: number; indent?: number; lineHeight?: number; spacingAfter?: number }) => {
    const fontSize = options.fontSize;
    const lineHeight = options.lineHeight ?? Math.ceil(fontSize * 1.62);
    const indent = options.indent ?? 0;
    const initialPage = getPage(lineHeight);
    initialPage.context.font = `${fontSize}px ${pdfFont}`;
    const lines = wrapPdfText(initialPage.context, value, pdfPage.width - pdfMargin * 2 - indent);
    let lineIndex = 0;
    while (lineIndex < lines.length) {
      const targetPage = getPage(lineHeight);
      targetPage.context.font = `${fontSize}px ${pdfFont}`;
      targetPage.context.fillStyle = options.color ?? pdfTextColor;
      targetPage.context.fillText(lines[lineIndex], pdfMargin + indent, targetPage.cursorY);
      targetPage.cursorY += lineHeight;
      lineIndex += 1;
    }
    page!.cursorY += options.spacingAfter ?? 8;
  };

  let codeFence = false;
  markdown.split(/\r?\n/).forEach((line) => {
    if (/^```/.test(line)) {
      codeFence = !codeFence;
      return;
    }
    if (!line.trim()) {
      if (page) page.cursorY += 10;
      return;
    }
    if (codeFence) {
      drawBlock(line, { color: "#365a55", fontSize: 20, indent: 24, lineHeight: 34, spacingAfter: 0 });
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      drawBlock(heading[2], {
        color: "#244f4c",
        fontSize: Math.max(26, 48 - (level - 1) * 5),
        lineHeight: Math.max(42, 66 - (level - 1) * 6),
        spacingAfter: level === 1 ? 22 : 14
      });
      return;
    }
    if (/^>\s?/.test(line)) {
      drawBlock(line.replace(/^>\s?/, ""), { color: "#365a55", fontSize: 23, indent: 28, spacingAfter: 8 });
      return;
    }
    const list = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.+)$/);
    if (list) {
      drawBlock(`• ${list[2]}`, { fontSize: 24, indent: Math.min(120, Math.floor(list[1].length / 2) * 34), spacingAfter: 4 });
      return;
    }
    drawBlock(line, { fontSize: 24, spacingAfter: 8 });
  });

  if (!pages.length) startPage();
  const images = pages.map(({ canvas }) => decodeBase64(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]));
  return createCompatibilityImagePdf(images);
}

export function createCompatibilityArtifactExportPayload(
  tab: ArtifactTab,
  format: ArtifactDocumentFormat
): ArtifactExportPayload {
  if (format === "docx") throw new Error("DOCX 请使用统一文档导出服务。");
  const fileStem = safeFileStem(tab.title);
  if (format === "markdown") {
    return {
      artifactId: tab.artifactId,
      content: createArtifactMarkdown(tab),
      contentEncoding: "utf8",
      fileName: `${fileStem}.md`,
      format,
      title: tab.title
    };
  }
  const html = createArtifactHtml(tab);
  if (format === "html") {
    return {
      artifactId: tab.artifactId,
      content: html,
      contentEncoding: "utf8",
      fileName: `${fileStem}.html`,
      format,
      title: tab.title
    };
  }
  return {
    artifactId: tab.artifactId,
    content: encodeBase64(createCompatibilityArtifactPdf(tab)),
    contentEncoding: "base64",
    fileName: `${fileStem}.pdf`,
    format,
    title: tab.title
  };
}

export function downloadArtifactPayload(payload: ArtifactExportPayload) {
  if (payload.contentEncoding === "base64") {
    downloadBlob(payload.fileName, decodeBase64(payload.content), payload.container === "zip" ? "application/zip" : documentFormats[payload.format].mimeType);
    return;
  }
  downloadBlob(payload.fileName, payload.content, documentFormats[payload.format].mimeType);
}

export async function exportArtifactDocument(tab: ArtifactTab, format: ArtifactDocumentFormat) {
  const { compileArtifactDocument } = await import("../document-export/artifactExportAdapter");
  const { renderExportDocument } = await import("../document-export/documentExportService");
  downloadArtifactPayload(await renderExportDocument(await compileArtifactDocument(tab), format));
}
