import { afterEach, describe, expect, test, vi } from "vitest";
import {
  artifactMarkdownToHtml,
  createArtifactHtml,
  createArtifactMarkdown
} from "../app/features/artifacts/artifactDocumentExport";
import type { ArtifactTab, ArtifactType } from "../app/features/artifacts/artifact.types";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { parseThinReadingDocument } from "../app/features/thin-reading/thinReadingVersioning";
import { v1Fixture } from "./fixtures/thinReadingVersionFixtures";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";
import { parseVisualizationArtifact } from "../app/features/visualization/visualizationArtifact.schema";
import type { VisualizationArtifactV1 } from "../app/features/visualization/visualizationArtifact.types";

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

  test("exports legacy v1 diagrams for read-only thin-reading artifacts", () => {
    const document = parseThinReadingDocument(v1Fixture);
    const markdown = createArtifactMarkdown({
      artifactId: document.artifactId,
      thinReadingDocument: document,
      title: "Legacy thin reading",
      type: "thin_reading"
    });

    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("flowchart LR");
    expect(markdown).toContain("```html");
    expect(markdown).toContain("Legacy demo");
  });

  test("omits executable legacy fields from new v2 thin-reading exports", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          interactiveDemo: {
            description: "Executable HTML should not be persisted into v2.",
            html: "<section><script>window.location='https://attacker.example'</script></section>",
            kind: "html",
            title: "V2 unsafe demo"
          },
          mermaid: "flowchart LR\nUnsafe-->Demo"
        }
      }
    });
    const markdown = createArtifactMarkdown({
      artifactId: document.artifactId,
      thinReadingDocument: document,
      title: "New thin reading",
      type: "thin_reading"
    });

    expect(markdown).not.toContain("Unsafe-->Demo");
    expect(markdown).not.toContain("V2 unsafe demo");
    expect(markdown).not.toContain("<script>");
  });

  test("exports v2 visual semantics and source attribution without executable markup", () => {
    const base = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...base,
      rootSeed: {
        ...base.rootSeed,
        evidence: {
          ...base.rootSeed.evidence,
          recommendedFigures: [{ evidenceIds: ["evidence-attention-self-attention"], figureId: "figure-fixture", reason: "方法图解" }],
          interactiveDemo: {
            description: "Must never be exported as executable HTML.",
            html: "<script>alert('unsafe')</script>",
            kind: "html",
            title: "Internal demo"
          },
          mermaid: "flowchart LR\ninternal-->renderer"
        }
      }
    });
    const generated = parseVisualizationArtifact(makeVisualizationArtifactFixture()) as VisualizationArtifactV1;
    const sourceFigure = parseVisualizationArtifact(
      makeVisualizationArtifactFixture({ modality: "source_figure" })
    ) as VisualizationArtifactV1;
    const root = document.nodes[document.rootNodeId];
    const v2Document = {
      ...document,
      nodes: {
        ...document.nodes,
        [root.id]: {
          ...root,
          visualizations: [
            {
              ...generated,
              artifactId: "generated-v2",
              accessibility: { summary: "生成可视化：展示方法流程。", objectReadingOrder: ["start"] },
              semanticObjects: [{ objectId: "start", kind: "process", label: "输入编码", objectPath: ["start"], evidenceClaimIds: ["claim-1"], selectable: true }],
              evidenceBindings: [{ claimId: "claim-1", evidenceIds: ["evidence-attention-self-attention"], confidence: "direct" }]
            },
            {
              ...sourceFigure,
              artifactId: "source-v2",
              spec: {
                modality: "source_figure",
                payload: {
                  sourceFigureId: "figure-3",
                  paperId: "paper-attention",
                  page: 3,
                  caption: "论文原图：模型架构",
                  imageRef: "https://cdn.example/raw-generated.png",
                  regions: [{ id: "region-a", bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 }, evidenceIds: ["evidence-attention-self-attention"] }],
                  extraction: { method: "fixture", confidence: 1 }
                }
              }
            }
          ]
        }
      }
    };
    const markdown = createArtifactMarkdown({
      artifactId: "artifact-thin-reading-v2",
      figures: [{ alt: "模型架构", dataUrl: "data:image/png;base64,fixture", id: "figure-fixture", page: 3, sourcePath: "/fixture.pdf" }],
      papers: [{ id: "paper-attention", title: "Attention Is All You Need" }],
      thinReadingDocument: v2Document,
      title: "V2 multimodal reading",
      type: "thin_reading"
    });

    expect(markdown).toContain("生成可视化");
    expect(markdown).toContain("输入编码");
    expect(markdown).toContain("evidence-attention-self-attention");
    expect(markdown).toContain("论文原图");
    expect(markdown).not.toContain("figure-fixture");
    expect(markdown).toContain("第 3 页");
    expect(markdown).toContain("0.1");
    expect(markdown).toContain("0.2");
    expect(markdown).not.toContain("<script");
    expect(markdown).not.toContain("```html");
    expect(markdown).not.toContain("flowchart LR");
    expect(markdown).not.toContain("raw-generated.png");
    expect(markdown).not.toContain("rendererId");
    expect(markdown).not.toContain("providerRouteId");
    expect(markdown).not.toContain("costPolicyVersion");
  });

  test("escapes v2 structured metadata and keeps evidence IDs scoped to their fields", () => {
    const base = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...base,
      rootSeed: {
        ...base.rootSeed,
        summary: "Unrelated evidence-one and __LITEASY_EVIDENCE_0__ must stay private.",
        evidence: {
          ...base.rootSeed.evidence,
          paperEvidenceSpans: [{
            confidence: 1,
            id: "evidence-one",
            page: 3,
            paperId: "paper-attention",
            quote: "Unrelated source prose."
          }]
        }
      }
    });
    const root = document.nodes[document.rootNodeId];
    const visual = parseVisualizationArtifact({
      ...makeVisualizationArtifactFixture(),
      accessibility: { summary: "<script>summary()</script>", objectReadingOrder: ["start"] },
      evidenceBindings: [{ claimId: "claim-one", confidence: "direct", evidenceIds: ["evidence-one-more"] }],
      semanticObjects: [{ objectId: "object-script", kind: "<script>kind()</script>", label: "<script>label()</script>", objectPath: ["start"], evidenceClaimIds: ["claim-one"], selectable: true }]
    }) as VisualizationArtifactV1;
    const markdown = createArtifactMarkdown({
      artifactId: document.artifactId,
      answer: "<script>answer()</script> [link](javascript:alert(1)) `code`",
      thinReadingDocument: {
        ...document,
        nodes: { ...document.nodes, [root.id]: { ...root, visualizations: [visual] } }
      },
      title: "V2 injection",
      type: "thin_reading"
    });

    expect(markdown).toContain("evidence-one-more");
    expect(markdown).not.toContain("evidence-one and");
    expect(markdown).toContain("__LITEASY_EVIDENCE_0__");
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("</script>");
    expect(markdown).not.toContain("[link]");
    expect(markdown).not.toContain("`code`");
  });

  test("exports only uniquely bound recommended source figures with their actual paper", () => {
    const base = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...base,
      rootSeed: {
        ...base.rootSeed,
        evidence: {
          ...base.rootSeed.evidence,
          paperEvidenceSpans: [
            { confidence: 1, id: "evidence-paper-a", page: 3, paperId: "paper-a", quote: "A" },
            { confidence: 1, id: "evidence-paper-b", page: 4, paperId: "paper-b", quote: "B" }
          ],
          recommendedFigures: [
            { evidenceIds: ["evidence-paper-a"], figureId: "figure-a", reason: "A" },
            { evidenceIds: ["evidence-paper-b"], figureId: "figure-b", reason: "B" },
            { evidenceIds: ["evidence-paper-a", "evidence-paper-b"], figureId: "figure-ambiguous", reason: "ambiguous" }
          ]
        }
      }
    });
    const markdown = createArtifactMarkdown({
      artifactId: document.artifactId,
      figures: [
        { alt: "figure a", dataUrl: "data:image/png;base64,a", id: "figure-a", page: 3, sourcePath: "/a.pdf" },
        { alt: "figure b", dataUrl: "data:image/png;base64,b", id: "figure-b", page: 4, sourcePath: "/b.pdf" },
        { alt: "ambiguous", dataUrl: "data:image/png;base64,c", id: "figure-ambiguous", page: 9, sourcePath: "/both.pdf" },
        { alt: "unrecommended", dataUrl: "data:image/png;base64,d", id: "figure-unrecommended", page: 3, sourcePath: "/a.pdf" }
      ],
      papers: [{ id: "paper-a", title: "Paper A" }, { id: "paper-b", title: "Paper B" }],
      thinReadingDocument: document,
      title: "Multi paper",
      type: "thin_reading"
    });

    expect(markdown).toContain("图：figure-a");
    expect(markdown).toContain("来源：paper-a · 第 3 页");
    expect(markdown).toContain("图：figure-b");
    expect(markdown).toContain("来源：paper-b · 第 4 页");
    expect(markdown).not.toContain("figure-ambiguous");
    expect(markdown).not.toContain("figure-unrecommended");
  });

  test("fails closed when a recommendation contains an unbound evidence ID", () => {
    const base = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...base,
      rootSeed: {
        ...base.rootSeed,
        evidence: {
          ...base.rootSeed.evidence,
          paperEvidenceSpans: [{ confidence: 1, id: "e-1", page: 3, paperId: "paper-a", quote: "A" }],
          recommendedFigures: [{ evidenceIds: ["e-1", "e-missing"], figureId: "figure-a", reason: "partial" }]
        }
      }
    });
    const markdown = createArtifactMarkdown({
      artifactId: document.artifactId,
      figures: [{ alt: "figure a", dataUrl: "data:image/png;base64,a", id: "figure-a", page: 3, sourcePath: "/a.pdf" }],
      thinReadingDocument: document,
      title: "Partial binding",
      type: "thin_reading"
    });

    expect(markdown).not.toContain("figure-a");
    expect(markdown).not.toContain("来源：paper-a");
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
