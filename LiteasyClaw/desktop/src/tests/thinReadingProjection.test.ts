import { describe, expect, test } from "vitest";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  advanceThinReadingDocument,
  createThinReadingDocument,
  listThinReadingBranchOptions
} from "../app/features/thin-reading/thinReadingProjection";

describe("thinReadingProjection", () => {
  test("creates a deterministic root document with omitted-section tokens", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      targetLanguage: "zh-CN"
    });
    const root = document.nodes[document.rootNodeId];

    expect(document).toMatchObject({
      artifactId: "artifact-thin-1",
      paperIds: ["paper-1"],
      targetLanguage: "zh-CN",
      version: "liteasy.thin-reading/v1"
    });
    expect(document.activeNodeId).toBe(document.rootNodeId);
    expect(root.omittedSections.map((token) => token.label)).toEqual([
      "实验",
      "消融",
      "数据集",
      "局限",
      "索引代价"
    ]);
    expect(root.source).toEqual({ kind: "root_overview" });
  });

  test("adds an omitted-section branch without mutating the input document", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      targetLanguage: "zh-CN"
    });
    const next = advanceThinReadingDocument(document, {
      parentNodeId: document.rootNodeId,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      summary: "实验部分聚焦 ColBERT 的检索效果与索引成本。",
      title: "实验"
    });

    expect(document.activeNodeId).toBe(document.rootNodeId);
    expect(document.nodes[document.rootNodeId].childIds).toEqual([]);
    expect(next.activeNodeId).not.toBe(document.rootNodeId);
    expect(next.nodes[next.activeNodeId]).toMatchObject({
      parentId: document.rootNodeId,
      depth: 1,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" }
    });
    expect(listThinReadingBranchOptions(next, document.rootNodeId)).toEqual([
      expect.objectContaining({
        sourceLabel: "遗漏板块",
        title: "实验",
        nodeId: next.activeNodeId,
        recommendationCount: expect.any(Number)
      })
    ]);
  });

  test("keeps fixture helpers on the production input shape", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument(fixture);

    expect(document.paperIds).toEqual(fixture.papers.map((paper) => paper.id));
  });
});
