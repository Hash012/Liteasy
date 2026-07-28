import { describe, expect, test } from "vitest";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  advanceThinReadingDocument,
  createThinReadingDocument,
  listThinReadingBranchOptions
} from "../app/features/thin-reading/thinReadingProjection";
import type { ThinReadingNodeSeed } from "../app/features/thin-reading/thinReading.types";

function seed(overrides: Partial<ThinReadingNodeSeed> = {}): ThinReadingNodeSeed {
  return {
    evidence: {
      externalKnowledge: [],
      paperEvidence: ["evidence-1"]
    },
    omittedSections: [
      { id: "section-experiment", label: "实验", sectionKey: "experiment" },
      { id: "section-ablation", label: "消融", sectionKey: "ablation" }
    ],
    recommendations: [
      {
        compatibility: 0.84,
        id: "intuecho-1",
        note: "本地待同步的理解线索。",
        relationship: "方法与问题设定"
      }
    ],
    summary: "ColBERT 的核心结论是通过 contextualized token embeddings 与 MaxSim late interaction 保留细粒度匹配信号。",
    withinPaperClosure: true,
    ...overrides
  };
}

describe("thinReadingProjection", () => {
  test("creates a deterministic root document with omitted-section tokens", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      papers: [{
        authors: ["Omar Khattab", "Matei Zaharia"],
        doi: "10.1145/3397271.3401075",
        id: "paper-1",
        title: "ColBERT",
        year: 2020
      }],
      rootSeed: seed(),
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
    expect(document.paperIdentities?.["paper-1"].primary).toMatchObject({
      kind: "doi",
      value: "10.1145/3397271.3401075"
    });
    expect(root.recommendationScope.paperIdentity?.primary.kind).toBe("doi");
    expect(root.omittedSections.map((token) => token.label)).toEqual(["实验", "消融"]);
    expect(root.source).toEqual({ kind: "root_overview" });
    expect(root.summary).toContain("MaxSim");
  });

  test("preserves structured evidence spans and claims on root documents", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-evidence-model",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        evidence: {
          claims: [
            {
              evidenceIds: ["evidence-1"],
              id: "claim-1",
              status: "grounded",
              text: "MaxSim 保留 token-level matching signals。"
            }
          ],
          externalKnowledge: [],
          paperEvidence: ["evidence-1"],
          paperEvidenceSpans: [
            {
              chunkId: "paper-1:p2:chunk-1",
              confidence: 0.91,
              id: "evidence-1",
              normalizedQuote: "colbert uses maxsim.",
              page: 2,
              paperId: "paper-1",
              quote: "ColBERT uses MaxSim."
            }
          ]
        }
      }),
      targetLanguage: "zh-CN"
    });
    const root = document.nodes[document.rootNodeId];

    expect(root.evidence.claims?.[0]).toMatchObject({
      evidenceIds: ["evidence-1"],
      status: "grounded"
    });
    expect(root.evidence.paperEvidenceSpans?.[0]).toMatchObject({
      chunkId: "paper-1:p2:chunk-1",
      page: 2,
      quote: "ColBERT uses MaxSim."
    });
  });

  test("falls back to local paper id when no global identity metadata is available", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-local-id",
      papers: [{ id: "paper-local", title: "Untitled Local Paper" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });

    expect(document.paperIdentities?.["paper-local"].primary).toMatchObject({
      kind: "local_paper_id",
      source: "local",
      value: "paper-local"
    });
  });

  test("uses model seed wording instead of local demo labels", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      importedChunksByPaperId: {
        "paper-1": [
          "ColBERT keeps contextualized token embeddings and uses MaxSim for late interaction.",
          "Its retrieval quality depends on preserving token-level matching signals."
        ]
      },
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        summary: "模型 seed 认为 ColBERT 的主轴是 MaxSim 保留 token-level matching signals。"
      }),
      targetLanguage: "zh-CN"
    });
    const root = document.nodes[document.rootNodeId];

    expect(document.title).toBe("ColBERT");
    expect(document.title).not.toMatch(/^薄读[:：]/);
    expect(root.title).toBe("ColBERT");
    expect(root.summary).toBe("模型 seed 认为 ColBERT 的主轴是 MaxSim 保留 token-level matching signals。");
    expect(root.summary).not.toMatch(/薄读总述|围绕.+薄读|真正留下/);
  });

  test("projects generated reading language from the target language", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-en",
      importedChunksByPaperId: {
        "paper-1": [
          "ColBERT keeps contextualized token embeddings and uses MaxSim for late interaction."
        ]
      },
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        omittedSections: [
          { id: "section-experiment", label: "Experiments", sectionKey: "experiment" }
        ],
        recommendations: [
          {
            compatibility: 0.84,
            id: "intuecho-en",
            note: "A local pending Intuecho lead.",
            relationship: "method and problem framing"
          }
        ],
        summary: "ColBERT keeps contextualized token embeddings and uses MaxSim for late interaction."
      }),
      targetLanguage: "en-US"
    });
    const root = document.nodes[document.rootNodeId];

    expect(root.omittedSections.map((token) => token.label)).toEqual(["Experiments"]);
    expect(root.recommendations[0]).toMatchObject({
      note: "A local pending Intuecho lead.",
      relationship: "method and problem framing"
    });
    expect(root.summary).toContain("ColBERT keeps contextualized token embeddings");
    expect(root.summary).not.toMatch(/围绕|薄读|可用上下文/);
  });

  test("adds an omitted-section branch without mutating the input document", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });
    const next = advanceThinReadingDocument(document, {
      parentNodeId: document.rootNodeId,
      seed: seed({
        omittedSections: [],
        summary: "实验部分聚焦 ColBERT 的检索效果与索引成本。"
      }),
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });

    expect(document.activeNodeId).toBe(document.rootNodeId);
    expect(document.nodes[document.rootNodeId].childIds).toEqual([]);
    expect(next.activeNodeId).not.toBe(document.rootNodeId);
    expect(next.nodes[next.activeNodeId]).toMatchObject({
      parentId: document.rootNodeId,
      depth: 1,
      recommendationScope: expect.objectContaining({
        kind: "section",
        paperIdentity: expect.objectContaining({
          primary: expect.objectContaining({ kind: "local_paper_id" })
        })
      }),
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

  test("stores private and pending-public annotations by artifact id", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-annotations",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });
    const next = addThinReadingAnnotation(document, {
      body: "这一句可以公开同步。",
      createdAt: "2026-07-28T00:00:00.000Z",
      excerpt: "MaxSim",
      nodeId: document.rootNodeId,
      visibility: "pending_public"
    });

    expect(next.annotations[0]).toMatchObject({
      artifactId: "artifact-thin-annotations",
      excerpt: "MaxSim",
      visibility: "pending_public"
    });
    expect(next.pendingPublicAnnotationIds).toEqual([next.annotations[0].id]);
  });
});
