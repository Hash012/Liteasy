import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { MAX_READING_FILE_BYTES, parseReadingFile } from "../app/features/reading-library/parseReadingFile";
import { readReadingArchive, readingFileLimits, resolveReadingPath } from "../app/features/reading-library/readingArchive";

function epub(files: Record<string, string | Uint8Array> = {}, version = 3) {
  return zipSync(Object.fromEntries(Object.entries({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
    "OPS/book.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>阅读与发现</dc:title><dc:creator>研究者</dc:creator><dc:language>zh-CN</dc:language><dc:publisher>学术出版社</dc:publisher><dc:date>2025-06-01</dc:date><dc:identifier>isbn:123456</dc:identifier></metadata><manifest><item id="second" href="two.xhtml" media-type="application/xhtml+xml" /><item id="first" href="one.xhtml" media-type="application/xhtml+xml" /><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml" /><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" /><item id="image" href="images/cover.png" media-type="image/png" /></manifest><spine toc="ncx"><itemref idref="first" /><itemref idref="second" /></spine></package>`,
    "OPS/one.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="intro">第一章</h1><p>第一章正文与公式。</p><img src="images/cover.png" alt="封面" /><a href="two.xhtml#next">继续阅读</a></body></html>',
    "OPS/two.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="next">第二章</h1><p>第二章介绍相关研究。</p></body></html>',
    "OPS/nav.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml#intro">开始阅读</a><ol><li><a href="two.xhtml#next">研究进展</a></li></ol></li></ol></nav></body></html>',
    "OPS/toc.ncx": '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>旧版目录</text></navLabel><content src="one.xhtml#intro" /></navPoint></navMap></ncx>',
    "OPS/images/cover.png": new Uint8Array([137, 80, 78, 71]),
    ...files
  }).map(([path, value]) => [path, typeof value === "string" ? strToU8(value) : value])));
}

describe("parseReadingFile", () => {
  test("reads EPUB metadata, actual spine order, nested navigation, internal links and embedded images", async () => {
    const book = await parseReadingFile({ name: "book.epub", bytes: epub() });
    expect(book).toMatchObject({ title: "阅读与发现", authors: ["研究者"], language: "zh-CN", publisher: "学术出版社", publishedAt: "2025-06-01", identifier: "isbn:123456" });
    expect(book.chapters.map((chapter) => chapter.sourcePath)).toEqual(["OPS/one.xhtml", "OPS/two.xhtml"]);
    expect(book.toc).toEqual([
      expect.objectContaining({ label: "开始阅读", chapterId: "chapter-1", anchor: "intro", depth: 0 }),
      expect.objectContaining({ label: "研究进展", chapterId: "chapter-2", anchor: "next", depth: 1 })
    ]);
    expect(book.chapters[0].content).toContain('data-reading-chapter="chapter-2"');
    expect(book.chapters[0].content).toContain('data-reading-image="OPS/images/cover.png"');
    expect(book.resources).toEqual([{ path: "OPS/images/cover.png", mimeType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) }]);
  });

  test("reads EPUB 2 NCX when no navigation document is present", async () => {
    const book = await parseReadingFile({ name: "old.epub", bytes: epub({ "OPS/nav.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body /></html>' }, 2) });
    expect(book.toc[0]).toMatchObject({ label: "旧版目录", chapterId: "chapter-1", anchor: "intro" });
  });

  test("splits a book-sized XHTML spine item into bounded sections and routes anchors to their actual section", async () => {
    const repeated = `<p>${"书中正文与思考。".repeat(2000)}</p>`.repeat(20);
    const book = await parseReadingFile({ name: "long.epub", bytes: epub({
      "OPS/one.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><div><h1>第一章</h1>${repeated}<p id="intro">最终位置&nbsp;与结论。</p></div></body></html>`
    }) });
    expect(book.chapters.length).toBeGreaterThan(3);
    expect(Math.max(...book.chapters.map((chapter) => chapter.content.length))).toBeLessThan(101_000);
    expect(book.toc[0].chapterId).toMatch(/^chapter-1-part-/);
    expect(book.chapters.find((chapter) => chapter.id === book.toc[0].chapterId)?.plainText).toContain("最终位置 与结论");
  });

  test("drops scripts, executable attributes, remote images, publisher CSS and embeds while retaining text/math", async () => {
    const book = await parseReadingFile({ name: "unsafe.epub", bytes: epub({ "OPS/one.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body onload="attack()"><script>attack()</script><style>@import "https://tracker.example/";</style><p style="background:url(https://tracker.example)">安全正文</p><img src="https://tracker.example/pixel.png" onerror="attack()" /><iframe src="https://tracker.example" /><a href="javascript:attack()">链接</a><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math></body></html>' }) });
    expect(book.chapters[0].content).toContain("安全正文");
    expect(book.chapters[0].content).toContain("<math>");
    expect(book.chapters[0].content).not.toMatch(/attack|tracker|script|iframe|style=/);
    expect(book.resources).toEqual([]);
  });

  test("rejects DRM, entity declarations and archive traversal", async () => {
    await expect(parseReadingFile({ name: "drm.epub", bytes: epub({ "META-INF/encryption.xml": '<encryption><EncryptionMethod Algorithm="https://drm.example/encryption" /></encryption>' }) })).rejects.toThrow("DRM");
    await expect(parseReadingFile({ name: "entity.epub", bytes: epub({ "OPS/one.xhtml": '<!DOCTYPE html [<!ENTITY bad "huge">]><html><body>&bad;</body></html>' }) })).rejects.toThrow("XML 实体");
    await expect(parseReadingFile({ name: "path.epub", bytes: epub({ "../outside.txt": "bad" }) })).rejects.toThrow("资源路径");
    expect(resolveReadingPath("OPS/chapter.xhtml", "../../../outside.png")).toBeUndefined();
  });

  test("explains unsupported fixed-layout EPUBs instead of silently reflowing them", async () => {
    await expect(parseReadingFile({ name: "fixed.epub", bytes: epub({
      "OPS/book.opf": '<package xmlns="http://www.idpf.org/2007/opf"><metadata><meta property="rendition:layout">pre-paginated</meta></metadata></package>'
    }) })).rejects.toThrow("固定版式");
    await expect(parseReadingFile({ name: "ibooks.epub", bytes: epub({
      "META-INF/com.apple.ibooks.display-options.xml": '<display_options><platform name="*"><option name="fixed-layout">true</option></platform></display_options>'
    }) })).rejects.toThrow("固定版式");
  });

  test("enforces declared and actual inflation limits and CRC integrity", async () => {
    expect(() => readReadingArchive(zipSync({ "huge.xhtml": new Uint8Array(readingFileLimits.entryBytes + 1) }))).toThrow("安全大小");
    const dishonest = zipSync({ "text.xhtml": strToU8("A".repeat(40_000)) });
    const view = new DataView(dishonest.buffer);
    let central = 0;
    for (let index = 0; index < dishonest.length - 4; index += 1) if (view.getUint32(index, true) === 0x02014b50) { central = index; break; }
    view.setUint32(central + 24, 1, true);
    const archive = readReadingArchive(dishonest);
    await expect(archive.read("text.xhtml")).rejects.toThrow("实际解压大小");
    const corrupt = zipSync({ "text.xhtml": strToU8("Original") });
    const corruptView = new DataView(corrupt.buffer);
    for (let index = 0; index < corrupt.length - 4; index += 1) if (corruptView.getUint32(index, true) === 0x02014b50) { corruptView.setUint32(index + 16, 0, true); break; }
    await expect(readReadingArchive(corrupt).read("text.xhtml")).rejects.toThrow("校验失败");
    await expect(parseReadingFile({ name: "large.epub", bytes: new Uint8Array(MAX_READING_FILE_BYTES + 1) })).rejects.toThrow("20 MB");
  });

  test("sections Markdown without interpreting headings inside code fences and preserves formulas", async () => {
    const source = "# 文献笔记\n\n正文 $x^2$\n\n```md\n# 不是章节\n```\n\n## 方法\n\n![实验](images/result.png)\n\n```mermaid\nflowchart LR\nA --> B\n```";
    const book = await parseReadingFile({ name: "notes.md", bytes: strToU8(source) });
    expect(book.title).toBe("文献笔记");
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].content).toContain("# 不是章节");
    expect(book.chapters[1].content).toContain("```mermaid");
    expect(book.warnings[0]).toContain("本地图片");
  });

  test("preserves UTF-16 and plain-text paragraphs while bounding long sections", async () => {
    const text = "第一章 开始\r\n第一行\r\n\r\n第二段\r\n第二章 发现\r\n结束";
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    const view = new DataView(utf16.buffer);
    for (let index = 0; index < text.length; index += 1) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
    const book = await parseReadingFile({ name: "中文.txt", bytes: utf16 });
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].content).toContain("第一行\n\n第二段");
    const large = await parseReadingFile({ name: "long.txt", bytes: strToU8("A".repeat(450_000)) });
    expect(large.chapters.length).toBeGreaterThan(1);
    expect(Math.max(...large.chapters.map((chapter) => chapter.content.length))).toBeLessThanOrEqual(300_002);
  });
});
