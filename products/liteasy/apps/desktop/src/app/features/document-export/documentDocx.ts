import { exportImageDimensions } from "./exportImage";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel,
  ImageRun, ExternalHyperlink, Header, Footer, PageNumber, AlignmentType, WidthType,
  FootnoteReferenceRun, LevelFormat, Math as WordMath, MathRun, MathFraction, MathRadical, MathSuperScript, MathSubScript, MathSubSuperScript, MathRoundBrackets, MathSum, MathIntegral,
  type MathComponent, type ParagraphChild, type IRunOptions,
} from "docx";
import type { DocumentNode, ExportDocument } from "./documentExport.types";

/** Deliberately bounded subset; an unrecognized TeX command is never silently dropped. */
export function texToWordMath(source: string): MathComponent[] {
  if (source.length > 8000) throw new Error("公式超过编辑支持范围");
  let offset = 0;
  const symbols: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω", infty: "∞", times: "×", cdot: "·", leq: "≤", geq: "≥", neq: "≠", pm: "±" };
  const bound = (depth: number) => { if (depth > 24) throw new Error("公式嵌套过深"); };
  const requiredGroup = (depth: number): MathComponent[] => {
    while (source[offset] === " ") offset++;
    if (source[offset++] !== "{") throw new Error("公式参数需要大括号");
    const result = sequence(depth + 1, "}");
    if (source[offset++] !== "}") throw new Error("公式括号不完整");
    return result;
  };
  const scripts = (depth: number) => {
    let subScript: MathComponent[] | undefined, superScript: MathComponent[] | undefined;
    while (/\s/.test(source[offset] ?? "")) offset++;
    while (source[offset] === "^" || source[offset] === "_") {
      const marker = source[offset++], value = atom(depth + 1);
      if (marker === "_") { if (subScript) throw new Error("公式包含重复下标"); subScript = value; }
      else { if (superScript) throw new Error("公式包含重复上标"); superScript = value; }
      while (/\s/.test(source[offset] ?? "")) offset++;
    }
    return { subScript, superScript };
  };
  const withScripts = (depth: number): MathComponent[] => {
    const children = atom(depth), { subScript, superScript } = scripts(depth);
    if (subScript && superScript) return [new MathSubSuperScript({ children, subScript, superScript })];
    if (subScript) return [new MathSubScript({ children, subScript })];
    if (superScript) return [new MathSuperScript({ children, superScript })];
    return children;
  };
  const atom = (depth: number): MathComponent[] => {
    bound(depth);
    while (/\s/.test(source[offset] ?? "")) offset++;
    const char = source[offset++];
    if (!char || char === "}" || char === "^" || char === "_") throw new Error("公式主体不完整");
    if (char === "{") { const children = sequence(depth + 1, "}"); if (source[offset++] !== "}") throw new Error("公式括号不完整"); return children; }
    if (char === "(") { const children = sequence(depth + 1, ")"); if (source[offset++] !== ")") throw new Error("公式括号不完整"); return [new MathRoundBrackets({ children })]; }
    if (char !== "\\") return [new MathRun(char)];
    const match = /^[a-zA-Z]+/.exec(source.slice(offset));
    if (!match) throw new Error("不支持的公式转义");
    const command = match[0]; offset += command.length;
    if (command === "frac") return [new MathFraction({ numerator: requiredGroup(depth), denominator: requiredGroup(depth) })];
    if (command === "sqrt") {
      let degree: MathComponent[] | undefined;
      while (/\s/.test(source[offset] ?? "")) offset++;
      if (source[offset] === "[") { offset++; degree = sequence(depth + 1, "]"); if (source[offset++] !== "]") throw new Error("根指数不完整"); }
      return [new MathRadical({ children: requiredGroup(depth), degree })];
    }
    if (command === "sum" || command === "int") {
      const limits = scripts(depth);
      while (source[offset] === " ") offset++;
      const children = withScripts(depth + 1);
      return [command === "sum" ? new MathSum({ children, ...limits }) : new MathIntegral({ children, ...limits })];
    }
    if (symbols[command]) return [new MathRun(symbols[command])];
    throw new Error("公式包含未支持的命令");
  };
  const sequence = (depth: number, end?: string): MathComponent[] => {
    bound(depth);
    const children: MathComponent[] = [];
    while (offset < source.length) {
      while (/\s/.test(source[offset] ?? "")) offset++;
      if (offset === source.length || source[offset] === end) break;
      children.push(...withScripts(depth));
    }
    return children;
  };
  const result = sequence(0);
  if (offset !== source.length) throw new Error("公式括号不完整");
  return result;
}
const rawText = (node: DocumentNode): string => node.value ?? (node.children ?? []).map(rawText).join("");
export function preflightDocx(document: ExportDocument) {
  const visit = (node: DocumentNode) => {
    if (node.type === "math") {
      try { texToWordMath(node.value ?? ""); }
      catch { if (!document.diagnostics.some(issue => issue.nodeId === node.id && issue.code === "math_not_editable")) document.diagnostics.push({ code: "math_not_editable", severity: "warning", nodeId: node.id, message: "此公式超出可编辑 Word 公式子集，DOCX 将保留完整 TeX 源码；HTML/PDF 保留数学排版。" }); }
    }
    if (node.properties?.footnoteDefinition && node.children?.some(child => child.tag === "table")) document.diagnostics.push({ code: "docx_footnote_table", severity: "error", nodeId: node.id, message: "DOCX 暂不支持脚注内嵌表格，请使用 HTML/PDF 或将表格移至正文。" });
    if (node.tag === "img") {
      const asset = document.assets.find(asset => asset.path === node.properties?.src);
      if (asset?.mediaType === "image/webp") document.diagnostics.push({ code: "docx_image_unsupported", severity: "error", nodeId: node.id, message: "DOCX 图片需要 PNG/JPEG/GIF，请先转换 WebP 原图。" });
    }
    node.children?.forEach(visit);
  };
  document.nodes.forEach(visit);
}
export async function renderDocumentDocx(document: ExportDocument): Promise<Uint8Array> {
  preflightDocx(document);
  if (document.diagnostics.some(issue => issue.severity === "error")) throw new Error("文档预检失败，请修复导出说明中的问题。");
  if (document.diagnostics.length && !document.options.acceptDegradations) throw new Error("此文档包含格式降级，请先确认导出说明。");
  const footnoteIds = new Map<string, number>(), footnoteNodes = new Map<string, DocumentNode>();
  const collectFootnotes = (nodes: DocumentNode[]) => { for (const node of nodes) {
    if (node.properties?.footnoteDefinition) { const key = String(node.properties.footnoteId); if (!footnoteIds.has(key)) footnoteIds.set(key, footnoteIds.size + 1); footnoteNodes.set(key, node); }
    if (node.children) collectFootnotes(node.children);
  } };
  collectFootnotes(document.nodes);
  const inline = (node: DocumentNode, style: IRunOptions = {}): ParagraphChild[] => {
    if (node.type === "text") return [new TextRun({ text: node.value ?? "", ...style })];
    if (node.properties?.footnoteId !== undefined && !node.properties.footnoteDefinition) { const id = footnoteIds.get(String(node.properties.footnoteId)); return id ? [new FootnoteReferenceRun(id)] : [new TextRun(`[${node.properties.footnoteId}]`)]; }
    if (node.type === "math") {
      try { return [new WordMath({ children: texToWordMath(node.value ?? "") })]; }
      catch { return [new TextRun({ text: `[公式源码：${node.value}]`, font: "Consolas", size: 18 })]; }
    }
    if (node.tag === "br") return [new TextRun({ break: 1 })];
    if (node.tag === "img") {
      const asset = document.assets.find(asset => asset.path === node.properties?.src);
      if (!asset) return [new TextRun(`图片缺失：${node.properties?.alt ?? ""}`)];
      const type = asset.mediaType === "image/jpeg" ? "jpg" : asset.mediaType === "image/gif" ? "gif" : "png";
      // Browser image decode gives natural dimensions; never stretch an image to a square.
      const size = dimensions.get(asset.path)!;
      return [new ImageRun({ type, data: asset.bytes, transformation: size, altText: { title: String(node.properties?.alt ?? "图片"), description: String(node.properties?.alt ?? "图片"), name: asset.id } })];
    }
    const children = (node.children ?? []).flatMap(child => inline(child, { ...style, ...(node.tag === "strong" ? { bold: true } : {}), ...(node.tag === "em" ? { italics: true } : {}), ...(node.tag === "del" ? { strike: true } : {}), ...(node.tag === "code" ? { font: "Consolas", size: 18 } : {}) }));
    if (node.tag === "a" && /^https?:|^mailto:/i.test(String(node.properties?.href ?? ""))) return [new ExternalHyperlink({ link: String(node.properties!.href), children })];
    return children;
  };
  const dimensions = new Map<string, { width: number; height: number }>();
  for (const asset of document.assets) {
    const image = exportImageDimensions(asset.bytes, asset.mediaType);
    const scale = Math.min(1, 640 / image.width, 850 / image.height);
    dimensions.set(asset.path, { width: image.width * scale, height: image.height * scale });
  }
  let listId = 0;
  const numberings: any[] = [];
  const blocks = (nodes: DocumentNode[], list?: { reference: string; level: number }): Array<Paragraph | Table> => nodes.flatMap(node => {
    if (node.properties?.footnoteDefinition) return [];
    if (node.tag === "table") {
      const rows = (node.children ?? []).flatMap(child => child.tag === "tr" ? [child] : (child.children ?? []).filter(row => row.tag === "tr"));
      const caption = node.children?.find(child => child.tag === "caption");
      return [...(caption ? [new Paragraph({ children: inline(caption), keepNext: true, style: "Caption" })] : []), new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(row => new TableRow({ tableHeader: (row.children ?? []).some(cell => cell.tag === "th"), children: (row.children ?? []).filter(cell => cell.tag === "td" || cell.tag === "th").map(cell => new TableCell({ columnSpan: Number(cell.properties?.colSpan ?? 1), rowSpan: Number(cell.properties?.rowSpan ?? 1), children: cell.children?.some(child => ["p", "pre", "ul", "ol", "table", "div"].includes(child.tag ?? "")) ? blocks(cell.children) : [new Paragraph({ children: inline(cell) })] })) })) })];
    }
    if (node.tag === "ul" || node.tag === "ol") {
      const reference = `list-${++listId}`;
      numberings.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({ level, format: node.tag === "ol" ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: node.tag === "ol" ? `%${level + 1}.` : "•", start: Number(node.properties?.start ?? 1), style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 240 } } } })) });
      return (node.children ?? []).flatMap(child => blocks(child.children ?? [], { reference, level: Math.min(8, (list?.level ?? -1) + 1) }));
    }
    if (["section", "div", "blockquote"].includes(node.tag ?? "")) return blocks(node.children ?? [], list);
    if (node.tag === "hr") return [new Paragraph({ children: [new TextRun("────────────────")], spacing: { after: 120 } })];
    if (node.tag === "pre") return [new Paragraph({ children: rawText(node).split("\n").flatMap((line, index) => [new TextRun({ text: line, font: "Consolas", size: 18, ...(index ? { break: 1 } : {}) })]), spacing: { after: 120 } })];
    if (node.type === "text" && !node.value?.trim()) return [];
    const heading = /^h[1-6]$/.test(node.tag ?? "") ? Number(node.tag![1]) : undefined;
    return [new Paragraph({ children: inline(node), heading: heading ? [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][heading - 1] : undefined, keepNext: Boolean(heading), widowControl: true, numbering: list, spacing: { after: 120, line: 352 } })];
  });
  const children = blocks(document.nodes);
  if (document.diagnostics.length) children.push(new Paragraph({ text: "导出说明", heading: HeadingLevel.HEADING_1 }), ...document.diagnostics.map(issue => new Paragraph(issue.message)));
  const footnotes = Object.fromEntries([...footnoteNodes].map(([key, node]) => [String(footnoteIds.get(key)), { children: blocks(node.children ?? []).filter((block): block is Paragraph => block instanceof Paragraph) }]));
  const result = new Document({ footnotes, title: document.title, creator: "Liteasy", styles: { default: { document: { run: { font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei" }, size: 22 }, paragraph: { spacing: { after: 120 } } } } }, numbering: { config: numberings }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1247, left: 1134 } } }, headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: document.title.slice(0, 60), size: 18 })] })] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) }, children }] });
  return new Uint8Array(await Packer.toArrayBuffer(result));
}
