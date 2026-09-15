import { describe, expect, test } from "vitest";
import { authoredArtifactMarkdown, parseAuthoredArtifact } from "../app/features/artifact-workflow/authoredArtifact";

const slide = { id: "intro", title: "方法", markdown: "**结论** $x^2$", notes: "根据论文介绍", evidenceIds: ["evidence-one"] };
const slides = { version: "liteasy.authored-artifact/v1", kind: "slides", title: "论文汇报", slides: [slide] };
const root = { id: "root", parentId: null, label: "核心", evidenceIds: ["evidence-one"] };
const outline = { version: "liteasy.authored-artifact/v1", kind: "outline", title: "大纲", nodes: [root] };

describe("authored artifact validation", () => {
  test("requires the versioned strict document and page shape", () => {
    expect(parseAuthoredArtifact(slides, new Set(["evidence-one"]))).toEqual(slides);
    for (const value of [
      { ...slides, extra: true },
      { ...slides, version: "other/v1" },
      { ...slides, slides: [{ ...slide, url: "https://example.org/forged.pptx" }] },
      { ...slides, slides: [{ id: "intro", title: "缺少正文" }] },
      { ...slides, slides: [] },
      { ...slides, title: "  \n" },
      { ...slides, slides: [{ ...slide, markdown: " \n\t" }] },
      { ...outline, nodes: [{ ...root, label: "  " }] }
    ]) expect(() => parseAuthoredArtifact(value)).toThrow();
  });

  test("rejects duplicate page/node IDs and references outside the supplied sources", () => {
    expect(() => parseAuthoredArtifact({ ...slides, slides: [slide, slide] })).toThrow("重复节点");
    expect(() => parseAuthoredArtifact({ ...outline, nodes: [root, root] })).toThrow("重复节点");
    expect(() => parseAuthoredArtifact(slides, new Set())).toThrow("未提供的来源");
    expect(() => parseAuthoredArtifact(outline, new Set(["evidence-other"]))).toThrow("未提供的来源");
  });

  test("rejects missing parents, self references, cycles and overdeep outlines", () => {
    const invalidNodes = [
      [{ ...root, parentId: "missing" }],
      [{ ...root, parentId: "root" }],
      [{ ...root, parentId: "child" }, { ...root, id: "child", parentId: "root" }],
      Array.from({ length: 21 }, (_, index) => ({ ...root, id: String(index), parentId: index ? String(index - 1) : null }))
    ];
    for (const nodes of invalidNodes) expect(() => parseAuthoredArtifact({ ...outline, nodes })).toThrow("层级无效或过深");
    const nodes = invalidNodes[3].slice(0, 20);
    expect(parseAuthoredArtifact({ ...outline, nodes })).toMatchObject({ nodes });
  });

  test("bounds complete slides, body size and outline node count", () => {
    expect(() => parseAuthoredArtifact({ ...slides, slides: Array.from({ length: 41 }, (_, index) => ({ ...slide, id: String(index) })) })).toThrow();
    expect(() => parseAuthoredArtifact({ ...slides, slides: [{ ...slide, markdown: "x".repeat(12_001) }] })).toThrow();
    expect(() => parseAuthoredArtifact({ ...outline, nodes: Array.from({ length: 1201 }, (_, index) => ({ ...root, id: String(index) })) })).toThrow();
  });

  test("projects page Markdown and speaker notes while keeping nested outline order", () => {
    expect(authoredArtifactMarkdown(parseAuthoredArtifact(slides))).toBe("# 论文汇报\n\n---\n\n## 方法\n\n**结论** $x^2$\n\n### 演讲备注\n\n根据论文介绍");
    const tree = parseAuthoredArtifact({ ...outline, nodes: [
      { ...root, id: "leaf", parentId: "branch", label: "细节" },
      root,
      { ...root, id: "branch", parentId: "root", label: "分支" },
      { ...root, id: "second", label: "另一个根" }
    ] });
    expect(authoredArtifactMarkdown(tree)).toBe("# 大纲\n\n- 核心\n  - 分支\n    - 细节\n- 另一个根");
  });
});
