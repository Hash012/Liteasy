import { normalizeArchivePath, readReadingArchive, readingFileLimits, resolveReadingPath } from "./readingArchive";
import type { ParsedReadingDocument, ReadingChapter, ReadingResource, ReadingTocEntry } from "./readingDocument.types";

export type { ParsedReadingDocument } from "./readingDocument.types";
export const MAX_READING_FILE_BYTES = readingFileLimits.inputBytes;
const xmlDecoder = new TextDecoder("utf-8", { fatal: true });
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const allowedTags = new Set("a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr".split(" "));
const mathTags = new Set("math mrow mi mn mo ms mtext mspace mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd maligngroup malignmark semantics annotation".split(" "));
const ignoredTags = new Set("script style link meta base iframe frame frameset object embed form input button textarea select option audio video source track canvas applet".split(" "));
const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS("*", name));
const textOf = (node: Document | Element, name: string) => elements(node, name)[0]?.textContent?.trim() || undefined;
export const readingAnchorId = (chapterId: string, fragment: string) => `reading-${chapterId.replace(/-part-\d+$/, "")}-${encodeURIComponent(fragment)}`;

function parseXml(value: string, label: string) {
  // External entities are never needed for EPUB content; no entity expansion or external fetches.
  if (/<!ENTITY\b/i.test(value) || /<!DOCTYPE[^>]*\[/i.test(value)) throw new Error(`${label}包含不支持的 XML 实体。`);
  const entityDecoder = window.document.createElement("textarea");
  const normalized = value.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/&([a-z][a-z0-9]+);/gi, (entity, name: string) => {
    if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return entity;
    entityDecoder.innerHTML = entity;
    const decoded = entityDecoder.value;
    return decoded === entity ? entity : Array.from(decoded).map((character) => `&#${character.codePointAt(0)};`).join("");
  });
  const parsed = new DOMParser().parseFromString(normalized, "application/xml");
  if (elements(parsed, "parsererror").length || parsed.documentElement.localName === "parsererror") throw new Error(`${label}格式不完整或已损坏。`);
  return parsed;
}

/** Bound rendered DOM even when a publisher stores an entire book in one XHTML spine item. */
function splitSafeHtml(content: string) {
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const limit = readingFileLimits.chapterCharacters;
  const splitNode = (node: Node): string[] => {
    const serialized = node.nodeType === 3 ? escaped(node.textContent ?? "") : (node as Element).outerHTML ?? "";
    if (serialized.length <= limit) return [serialized];
    if (node.nodeType === 3) {
      const parts: string[] = [];
      const text = node.textContent ?? "";
      for (let offset = 0; offset < text.length; offset += Math.floor(limit / 6)) parts.push(escaped(text.slice(offset, offset + Math.floor(limit / 6))));
      return parts;
    }
    const element = node as Element;
    const shell = element.cloneNode(false) as Element;
    const parts: string[] = [];
    let current = "";
    const flush = () => {
      if (!current) return;
      shell.innerHTML = current;
      parts.push(shell.outerHTML);
      shell.removeAttribute("id");
      current = "";
    };
    for (const child of Array.from(element.childNodes)) for (const fragment of splitNode(child)) {
      if (current.length + fragment.length > limit) flush();
      current += fragment;
    }
    flush();
    return parts;
  };
  const parts: string[] = [];
  let current = "";
  for (const child of Array.from(parsed.body.childNodes)) for (const fragment of splitNode(child)) {
    if (current.length + fragment.length > limit && current) { parts.push(current); current = ""; }
    current += fragment;
  }
  if (current || !parts.length) parts.push(current);
  return parts;
}

function htmlPlainText(content: string) {
  const parsed = new DOMParser().parseFromString(content, "text/html");
  for (const block of Array.from(parsed.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,tr,section,article,div,br"))) block.appendChild(parsed.createTextNode("\n"));
  return parsed.body.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
}

function decodeText(bytes: Uint8Array, warnings: string[]) {
  if (bytes.length > readingFileLimits.textBytes) throw new Error("文本文件超过 8 MB，请拆分后导入。");
  let result: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) result = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) result = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  else {
    try { result = xmlDecoder.decode(bytes); }
    catch {
      try { result = new TextDecoder("gb18030", { fatal: true }).decode(bytes); warnings.push("已按 GB18030 编码读取文本。"); }
      catch { throw new Error("无法识别文本编码，请另存为 UTF-8 后重新导入。"); }
    }
  }
  if (/[\u0000]/.test(result) || (result.match(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g)?.length ?? 0) > result.length / 100) throw new Error("此文件包含二进制内容，无法作为文本读取。");
  return result.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
}

/** Section at headings and bounded paragraph/line boundaries, keeping ordinary fenced blocks together. */
function textChapters(text: string, title: string, markdown: boolean) {
  const chapters: ReadingChapter[] = [];
  let lines: string[] = [];
  let size = 0;
  let heading = title;
  let fence: string | undefined;
  const flush = () => {
    const content = lines.join("\n").trim();
    if (content) chapters.push({ id: `chapter-${chapters.length + 1}`, title: heading, content, plainText: content, format: markdown ? "markdown" : "text" });
    lines = [];
    size = 0;
    if (chapters.length > readingFileLimits.chapters) throw new Error("文档章节过多，请拆分后导入。");
  };
  for (const line of text.split("\n")) {
    const fenceMatch = markdown ? line.match(/^ {0,3}(`{3,}|~{3,})/) : null;
    const section = !fence ? (markdown ? line.match(/^ {0,3}#{1,2}\s+(.+?)\s*#*$/) : line.match(/^\s*((?:第[\d一二三四五六七八九十百千零〇]+[章节部卷篇]|chapter\s+\d+).{0,80})$/i)) : null;
    if (section && lines.length) flush();
    if (section) heading = section[1].trim();
    if (size > readingFileLimits.chapterCharacters && !fence && !line.trim()) { flush(); heading = `${title} · ${chapters.length + 1}`; }
    // A single pathological line/fence cannot produce an unbounded React/Markdown tree.
    for (let start = 0; start < Math.max(line.length, 1); start += readingFileLimits.chapterCharacters) {
      if (size > readingFileLimits.chapterCharacters * 2) { flush(); heading = `${title} · ${chapters.length + 1}`; }
      const part = line.slice(start, start + readingFileLimits.chapterCharacters);
      lines.push(part); size += part.length + 1;
    }
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
    }
  }
  flush();
  if (!chapters.length) chapters.push({ id: "chapter-1", title, content: "", plainText: "", format: markdown ? "markdown" : "text" });
  return chapters;
}

type ManifestItem = { id: string; path: string; mediaType: string; properties: string };

function sanitizeChapter(root: Element, chapterId: string, sourcePath: string, chapterByPath: Map<string, ReadingChapter>, resources: Map<string, ManifestItem>, usedImages: Set<string>) {
  let visited = 0;
  const walk = (node: Node, depth: number): string => {
    visited += 1;
    if (visited > 100_000 || depth > 100) throw new Error("电子书章节结构过于复杂，请拆分后导入。");
    if (node.nodeType === 3) return escaped(node.textContent ?? "");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (ignoredTags.has(tag)) return "";
    // Common EPUB covers use an SVG wrapper around a raster image. Keep the image without the SVG execution surface.
    if (tag === "image" || tag === "img") {
      const source = resolveReadingPath(sourcePath, element.getAttribute("src") ?? element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "");
      if (!source || !imageTypes.has(resources.get(source.path)?.mediaType ?? "")) return `<span class="reading-image-unavailable">${escaped(element.getAttribute("alt") || "图片暂不可用")}</span>`;
      usedImages.add(source.path);
      return `<img data-reading-image="${escaped(source.path)}" alt="${escaped(element.getAttribute("alt") ?? "插图")}" loading="lazy" decoding="async" />`;
    }
    const children = Array.from(node.childNodes).map((child) => walk(child, depth + 1)).join("");
    if (!allowedTags.has(tag) && !mathTags.has(tag)) return children;
    const attributes: string[] = [];
    const id = element.getAttribute("id") ?? element.getAttribute("xml:id");
    if (id) attributes.push(`id="${escaped(readingAnchorId(chapterId, id))}"`);
    for (const attribute of ["lang", "dir", "title", ...(tag === "td" || tag === "th" ? ["colspan", "rowspan"] : []), ...(tag === "ol" ? ["start", "reversed"] : []), ...(mathTags.has(tag) ? ["display", "mathvariant", "stretchy", "fence", "columnalign", "rowalign"] : [])]) {
      const value = element.getAttribute(attribute);
      if (value && value.length < 200) attributes.push(`${attribute}="${escaped(value)}"`);
    }
    if (tag === "a") {
      const target = resolveReadingPath(sourcePath, element.getAttribute("href") ?? "");
      const targetChapter = target && chapterByPath.get(target.path);
      if (targetChapter) {
        attributes.push(`href="#${escaped(target.anchor ? readingAnchorId(targetChapter.id, target.anchor) : targetChapter.id)}"`, `data-reading-chapter="${targetChapter.id}"`);
        if (target?.anchor) attributes.push(`data-reading-anchor="${escaped(target.anchor)}"`);
      } else {
        const href = element.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(href)) attributes.push(`href="${escaped(href)}"`, 'rel="noreferrer noopener"', 'target="_blank"');
      }
    }
    return `<${tag}${attributes.length ? " " + attributes.join(" ") : ""}>${children}${["br", "hr", "wbr", "col"].includes(tag) ? "" : `</${tag}>`}`;
  };
  return walk(root, 0);
}

async function parseEpub(name: string, bytes: Uint8Array): Promise<ParsedReadingDocument> {
  const archive = readReadingArchive(bytes);
  const readXml = async (path: string, label: string) => {
    const data = await archive.read(path);
    if (!data) throw new Error(`${label}缺失：${path}`);
    const decoder = data[0] === 0xff && data[1] === 0xfe ? new TextDecoder("utf-16le", { fatal: true }) : data[0] === 0xfe && data[1] === 0xff ? new TextDecoder("utf-16be", { fatal: true }) : xmlDecoder;
    return parseXml(decoder.decode(data), label);
  };
  const mime = await archive.read("mimetype");
  if (!mime || xmlDecoder.decode(mime).trim() !== "application/epub+zip") throw new Error("此文件不是有效的 EPUB 电子书。");
  const warnings: string[] = [];
  if (archive.has("META-INF/encryption.xml")) {
    const encryption = await readXml("META-INF/encryption.xml", "加密信息");
    const algorithms = elements(encryption, "EncryptionMethod").map((element) => element.getAttribute("Algorithm"));
    if (!algorithms.length || algorithms.some((algorithm) => !["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"].includes(algorithm ?? ""))) throw new Error("此电子书已加密，暂不支持 DRM 保护的电子书。");
    warnings.push("此书的混淆字体已替换为阅读器字体。");
  }
  const container = await readXml("META-INF/container.xml", "电子书容器");
  const rootPath = elements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!rootPath) throw new Error("电子书未声明内容包。");
  const packagePath = normalizeArchivePath(rootPath);
  const book = await readXml(packagePath, "电子书内容包");
  const metadata = elements(book, "metadata")[0];
  const fixedLayoutMessage = "此 EPUB 使用固定版式，当前阅读器支持可重排电子书。请改用 PDF 或可重排 EPUB。";
  if (elements(book, "meta").some((element) => {
    const name = element.getAttribute("property") ?? element.getAttribute("name");
    const value = (element.getAttribute("content") ?? element.textContent ?? "").trim().toLowerCase();
    return name === "rendition:layout" && value === "pre-paginated" || name === "fixed-layout" && value === "true";
  }) || elements(book, "itemref").some((element) => element.getAttribute("properties")?.split(/\s+/).includes("rendition:layout-pre-paginated"))) throw new Error(fixedLayoutMessage);
  if (archive.has("META-INF/com.apple.ibooks.display-options.xml")) {
    const displayOptions = await readXml("META-INF/com.apple.ibooks.display-options.xml", "电子书版式信息");
    if (elements(displayOptions, "option").some((element) => element.getAttribute("name") === "fixed-layout" && element.textContent?.trim().toLowerCase() === "true")) throw new Error(fixedLayoutMessage);
  }
  const manifest = new Map<string, ManifestItem>();
  for (const element of elements(book, "item")) {
    const id = element.getAttribute("id");
    const resolved = resolveReadingPath(packagePath, element.getAttribute("href") ?? "");
    if (id && resolved) manifest.set(id, { id, path: resolved.path, mediaType: element.getAttribute("media-type") ?? "", properties: element.getAttribute("properties") ?? "" });
  }
  const resourceByPath = new Map([...manifest.values()].map((item) => [item.path, item]));
  const chapters: ReadingChapter[] = [];
  // Auxiliary spine items (often footnotes) remain reachable after the normal reading order.
  const spine = elements(book, "itemref").sort((left, right) => Number(left.getAttribute("linear") === "no") - Number(right.getAttribute("linear") === "no"));
  for (const entry of spine) {
    const item = manifest.get(entry.getAttribute("idref") ?? "");
    if (!item || !["application/xhtml+xml", "text/html"].includes(item.mediaType)) throw new Error("电子书含有暂不支持的正文类型。");
    if (chapters.length >= readingFileLimits.chapters) throw new Error("电子书章节过多，请拆分后导入。");
    chapters.push({ id: `chapter-${chapters.length + 1}`, title: `第 ${chapters.length + 1} 节`, content: "", plainText: "", format: "html", sourcePath: item.path });
  }
  if (!chapters.length) throw new Error("电子书没有可阅读的正文。");
  const chapterByPath = new Map(chapters.map((chapter) => [chapter.sourcePath!, chapter]));
  const toc: ReadingTocEntry[] = [];
  const appendToc = (label: string, href: string, base: string, depth: number) => {
    const resolved = resolveReadingPath(base, href);
    const chapter = resolved && chapterByPath.get(resolved.path);
    if (chapter && label && toc.length < 2000) {
      toc.push({ id: `toc-${toc.length + 1}`, label, chapterId: chapter.id, depth: Math.min(depth, 6), ...(resolved?.anchor ? { anchor: resolved.anchor } : {}) });
      if (chapter.title.startsWith("第 ")) chapter.title = label;
    }
  };
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  if (nav) {
    const navigation = await readXml(nav.path, "电子书目录");
    const region = elements(navigation, "nav").find((element) => (element.getAttribute("epub:type") ?? element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "").split(/\s+/).includes("toc")) ?? elements(navigation, "nav")[0];
    if (region) for (const link of elements(region, "a")) {
      let depth = -1;
      for (let parent = link.parentElement; parent && parent !== region; parent = parent.parentElement) if (parent.localName === "ol") depth += 1;
      appendToc(link.textContent?.trim() ?? "", link.getAttribute("href") ?? "", nav.path, Math.max(0, depth));
    }
  }
  if (!toc.length) {
    const ncxId = elements(book, "spine")[0]?.getAttribute("toc");
    const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml");
    if (ncx) for (const point of elements(await readXml(ncx.path, "电子书目录"), "navPoint")) {
      let depth = 0;
      for (let parent = point.parentElement; parent; parent = parent.parentElement) if (parent.localName === "navPoint") depth += 1;
      appendToc(textOf(point, "text") ?? "", elements(point, "content")[0]?.getAttribute("src") ?? "", ncx.path, depth);
    }
  }
  const usedImages = new Set<string>();
  const splitChapters: ReadingChapter[] = [];
  const anchorChapter = new Map<string, string>();
  for (const chapter of chapters) {
    const source = await readXml(chapter.sourcePath!, "电子书章节");
    const body = elements(source, "body")[0];
    if (!body) throw new Error("电子书章节缺少正文。");
    if (chapter.title.startsWith("第 ")) chapter.title = textOf(body, "h1") ?? textOf(body, "h2") ?? chapter.title;
    const fragments = splitSafeHtml(sanitizeChapter(body, chapter.id, chapter.sourcePath!, chapterByPath, resourceByPath, usedImages));
    fragments.forEach((content, index) => {
      const id = index ? `${chapter.id}-part-${index + 1}` : chapter.id;
      splitChapters.push({ ...chapter, id, title: fragments.length > 1 ? `${chapter.title} · ${index + 1}` : chapter.title, content, plainText: htmlPlainText(content) });
      const fragment = new DOMParser().parseFromString(content, "text/html");
      fragment.querySelectorAll("[id]").forEach((element) => anchorChapter.set(element.id, id));
    });
    if (splitChapters.length > readingFileLimits.chapters) throw new Error("电子书章节过多，请拆分后导入。");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  for (const entry of toc) if (entry.anchor) entry.chapterId = anchorChapter.get(readingAnchorId(entry.chapterId, entry.anchor)) ?? entry.chapterId;
  for (const chapter of splitChapters) {
    const fragment = new DOMParser().parseFromString(chapter.content, "text/html");
    for (const link of Array.from(fragment.querySelectorAll("a[data-reading-chapter][data-reading-anchor]"))) {
      const targetId = readingAnchorId(link.getAttribute("data-reading-chapter")!, link.getAttribute("data-reading-anchor")!);
      const target = anchorChapter.get(targetId);
      if (target) link.setAttribute("data-reading-chapter", target);
    }
    chapter.content = fragment.body.innerHTML;
  }
  const resources: ReadingResource[] = [];
  for (const path of usedImages) {
    const data = await archive.read(path);
    if (data) resources.push({ path, mimeType: resourceByPath.get(path)!.mediaType, bytes: data });
  }
  if (!toc.length) toc.push(...splitChapters.map((chapter) => ({ id: chapter.id, chapterId: chapter.id, label: chapter.title, depth: 0 })));
  return {
    format: "epub", title: metadata && textOf(metadata, "title") || name.replace(/\.epub$/i, ""),
    authors: metadata ? elements(metadata, "creator").map((node) => node.textContent?.trim() ?? "").filter(Boolean) : [],
    language: metadata && textOf(metadata, "language"), publisher: metadata && textOf(metadata, "publisher"),
    publishedAt: metadata && textOf(metadata, "date"), identifier: metadata && textOf(metadata, "identifier"),
    description: metadata && textOf(metadata, "description"), chapters: splitChapters, toc, resources, warnings
  };
}

export async function parseReadingFile({ name, bytes }: { name: string; bytes: Uint8Array }): Promise<ParsedReadingDocument> {
  if (bytes.byteLength > MAX_READING_FILE_BYTES) throw new Error("文件超过 20 MB，请拆分后导入。");
  if (/\.epub$/i.test(name)) return parseEpub(name, bytes);
  const markdown = /\.(?:md|markdown)$/i.test(name);
  if (!markdown && !/\.txt$/i.test(name)) throw new Error("请选择 EPUB、Markdown 或 TXT 文件。");
  const warnings: string[] = [];
  const text = decodeText(bytes, warnings);
  const title = markdown ? text.match(/^ {0,3}#\s+(.+?)\s*#*$/m)?.[1] ?? name.replace(/\.[^.]+$/, "") : name.replace(/\.[^.]+$/, "");
  const chapters = textChapters(text, title, markdown);
  if (markdown && /!\[[^\]]*\]\((?!https?:\/\/|data:)[^)]+\)/i.test(text)) warnings.push("单独导入的 Markdown 无法读取旁边的本地图片；请使用内嵌图片或 HTTPS 图片地址。");
  return { format: markdown ? "markdown" : "text", title, authors: [], chapters, toc: chapters.map((chapter) => ({ id: chapter.id, label: chapter.title, chapterId: chapter.id, depth: 0 })), resources: [], warnings };
}
