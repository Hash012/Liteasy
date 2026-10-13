import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { expect, test, vi } from "vitest";
import { compileDocument } from "../app/features/document-export/documentCompiler";
import { compileArtifactDocument } from "../app/features/document-export/artifactExportAdapter";
import { renderDocumentDocx } from "../app/features/document-export/documentDocx";
import { renderDocumentHtml } from "../app/features/document-export/documentHtml";
import { renderDocumentMarkdown } from "../app/features/document-export/documentMarkdown";
import { createArtifactSourceMarkdown } from "../app/features/artifacts/artifactDocumentExport";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
const fixture = readFileSync(resolve("../../../../development/test-data/document-export/ui-root-cause-rich.md"), "utf8");

test("artifact export preserves source code spacing and literal citation-like tokens", () => {
  const source = '# Code\n\n```ts\nconst example = "A , B ; [evidence:demo]";\n```';
  expect(createArtifactSourceMarkdown({ artifactId: "synthetic", type: "skill_doc", title: "Synthetic", markdown: source })).toContain('const example = "A , B ; [evidence:demo]";');
});
test("DOCX keeps rich tight list items in one numbered paragraph and quotes as quotes", async () => {
  const doc = await compileDocument({ title: "List", markdown: '- Start **bold** end\n- Second\n\n> Quoted **source**\n>\n> Second quote paragraph' });
  const xml = strFromU8(unzipSync(await renderDocumentDocx(doc))["word/document.xml"]);
  expect(xml.match(/<w:numPr>/g)).toHaveLength(2);
  expect(xml).toContain('w:pStyle w:val="Quote"');
});
test("a conservative wide math fallback is explicit and preserves the whole formula", async () => {
  const formula = Array.from({ length: 40 }, (_, i) => `x_{${i}}`).join("+");
  const doc = await compileDocument({ title: "Wide", markdown: `$$\n${formula}\n$$` });
  expect(doc.diagnostics.some(issue => issue.code === "wide_math_source")).toBe(true);
  expect(renderDocumentHtml(doc)).toContain("完整公式源码");
  expect(renderDocumentMarkdown(doc)).toContain(formula);
});
test("rich document preserves semantic blocks and all tail content without model or network calls", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
  try {
    const doc = await compileDocument({ title: "Rich", markdown: fixture, options: { acceptDegradations: true } });
    const html = renderDocumentHtml(doc), markdown = renderDocumentMarkdown(doc);
    expect(html).toContain("<table>"); expect(html).toContain("<blockquote>"); expect(html).toContain("<math");
    expect(markdown).toContain('std::fs::read(path)'); expect(markdown).toContain("[^test]");
    expect(html).toContain("END-OF-SYNTHETIC-DOCUMENT");
    expect(doc.diagnostics.some(issue => issue.code === "missing_asset")).toBe(true);
    const files = unzipSync(await renderDocumentDocx(doc));
    expect(strFromU8(files["word/document.xml"])).toContain("END-OF-SYNTHETIC-DOCUMENT");
    expect(strFromU8(files["word/footnotes.xml"])).toContain("脚注内容为合成文本");
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
test("all saved thin-reading nodes and explicit evidence modes retain complete source paragraphs", async () => {
  const thin = structuredClone(createThinReadingDocument(createThinReadingFixture()));
  const root = thin.nodes[thin.rootNodeId];
  root.summary = "旧长段".repeat(600);
  root.evidence.paperEvidenceSpans![0].quote = "First paragraph.\n\nSecond paragraph. " + "Evidence ".repeat(120) + "EVIDENCE-END";
  thin.nodes.detached = { ...structuredClone(root), id: "detached", title: "屏幕外保存节点", summary: "DETACHED-SAVED-END", childIds: [], evidence: { ...root.evidence, paperEvidenceSpans: [] } };
  const tab = { artifactId: "synthetic", title: "Synthetic", type: "thin_reading" as const, thinReadingDocument: thin };
  const doc = await compileArtifactDocument(tab, { options: { evidenceMode: "full_appendix" } });
  const md = renderDocumentMarkdown(doc);
  expect(md).toContain(root.summary); expect(md).toContain("DETACHED-SAVED-END"); expect(md).toContain("EVIDENCE-END");
  expect(md).toContain("First paragraph.\n> \n> Second paragraph.");
  expect(doc.diagnostics.some(issue => issue.code === "source_long_paragraph")).toBe(true);
  const excerpt = createArtifactSourceMarkdown(tab, { evidenceMode: "excerpts" });
  expect(excerpt).toContain("证据摘录；可选择完整证据附录"); expect(excerpt).not.toContain("EVIDENCE-END");
  const references = createArtifactSourceMarkdown(tab, { evidenceMode: "references" });
  expect(references).toContain("来源索引"); expect(references).not.toContain("First paragraph");
});
