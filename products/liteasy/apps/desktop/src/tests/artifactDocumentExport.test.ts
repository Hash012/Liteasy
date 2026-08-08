import { afterEach, describe, expect, test, vi } from "vitest";
import {
  artifactMarkdownToHtml,
  createArtifactHtml,
  createArtifactMarkdown,
  createArtifactExportPayload
} from "../app/features/artifacts/artifactDocumentExport";
import type { ArtifactTab, ArtifactType } from "../app/features/artifacts/artifact.types";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";

const artifactTypes: ArtifactType[] = [
  "comparison_table",
  "layered_graph",
  "mindmap",
  "ppt",
  "skill_doc",
  "thin_reading",
  "tree"
];

function createTab(type: ArtifactType): ArtifactTab {
  const base: ArtifactTab = {
    answer: "核心结论来自论文证据。",
    artifactId: `artifact-${type}`,
    outlineNodes: [{
      evidenceIds: ["evidence-private-123"],
      id: "root",
      kind: "root",
      label: "核心结构 [evidence-private-123]"
    }],
    papers: [{ id: "paper-1", title: "QVLA" }],
    title: `${type} 导出样例`,
    type
  };
  if (type === "skill_doc") return { ...base, markdown: "# Skill 文档\n\n执行步骤。" };
  if (type === "thin_reading") {
    return {
      ...base,
      thinReadingDocument: createThinReadingDocument(createThinReadingFixture())
    };
  }
  return base;
}

describe("artifact document export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(artifactTypes)("creates portable Markdown and HTML for %s", (type) => {
    const tab = createTab(type);
    const markdown = createArtifactMarkdown(tab);
    const html = createArtifactHtml(tab);

    expect(markdown).toContain(type === "skill_doc" ? "Skill 文档" : tab.title);
    expect(markdown).not.toContain("evidence-private-123");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<meta charset=\"utf-8\"");
    expect(html).not.toContain("evidence-private-123");
  });

  test("converts headings, nested list items, code, and quotes into printable HTML", () => {
    const html = artifactMarkdownToHtml([
      "# 标题",
      "- 一级",
      "  - 二级",
      "> 证据摘录",
      "```mermaid",
      "A --> B",
      "```"
    ].join("\n"));

    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain('class="list-item depth-1"');
    expect(html).toContain("<blockquote>证据摘录</blockquote>");
    expect(html).toContain('class="language-mermaid"');
  });

  test("includes thin-reading Agent analysis and removes internal evidence IDs everywhere", () => {
    const tab = createTab("thin_reading");
    tab.answer = "补充 Agent 结论 [evidence-private-123]。";
    const document = tab.thinReadingDocument!;
    const rootNode = document.nodes[document.rootNodeId];
    tab.thinReadingDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        [rootNode.id]: { ...rootNode, summary: `${rootNode.summary} evidence-private-123` }
      }
    };

    const markdown = createArtifactMarkdown(tab);

    expect(markdown).toContain("## Agent 分析");
    expect(markdown).toContain("补充 Agent 结论。");
    expect(markdown).not.toContain("evidence-private-123");
  });

  test("creates a native payload without triggering a browser download", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    const payload = createArtifactExportPayload(createTab("thin_reading"), "markdown");

    expect(payload).toEqual(expect.objectContaining({
      artifactId: "artifact-thin_reading",
      contentEncoding: "utf8",
      fileName: "thin_reading 导出样例.md",
      format: "markdown",
      title: "thin_reading 导出样例"
    }));
    expect(payload.content).toContain("Agent 分析");
    expect(click).not.toHaveBeenCalled();
  });

  test("encodes generated PDF bytes as base64 in the export payload", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      fillStyle: "#fff",
      fillText: vi.fn(),
      font: "",
      measureText: (value: string) => ({ width: value.length * 10 })
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64,/9j/");

    const payload = createArtifactExportPayload(createTab("mindmap"), "pdf");

    expect(payload.contentEncoding).toBe("base64");
    expect(payload.fileName).toBe("mindmap 导出样例.pdf");
    expect(atob(payload.content).slice(0, 8)).toBe("%PDF-1.7");
  });
});
