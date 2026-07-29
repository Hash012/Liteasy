import { beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactLocalRepository } from "../app/features/artifacts/artifactLocalRepository";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";

describe("artifactLocalRepository", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("loads only valid multimodal artifact records", async () => {
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [
          { artifactId: "artifact-1", title: "Tree", type: "tree" },
          { artifactId: "skill-doc-1", title: "Skill", type: "skill_doc" },
          { artifactId: "broken", type: "tree" }
        ],
        savedAt: "2026-07-21T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([
      { artifactId: "artifact-1", title: "Tree", type: "tree" }
    ]);
  });

  test("rejects malformed cached thin-reading documents but restores complete ones", async () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-valid",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "A traceable summary.",
        withinPaperClosure: true
      },
      targetLanguage: "en-US"
    });
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [
          { artifactId: "artifact-thin-valid", thinReadingDocument: document, title: "Thin reading", type: "thin_reading" },
          {
            artifactId: "artifact-thin-broken",
            thinReadingDocument: {
              ...document,
              artifactId: "artifact-thin-broken",
              nodes: {
                ...document.nodes,
                [document.rootNodeId]: {
                  ...document.nodes[document.rootNodeId],
                  parentId: document.rootNodeId
                }
              }
            },
            title: "Broken thin reading",
            type: "thin_reading"
          }
        ],
        savedAt: "2026-07-21T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ artifactId: "artifact-thin-valid", thinReadingDocument: document })
    ]);
  });

  test("restores a valid persisted generation audit and rejects forged evidence-plan provenance", async () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-audit-cache",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: {
          externalKnowledge: [],
          generationAudit: {
            evidencePlan: { focus: ["核心贡献"], selectedEvidenceIds: ["evidence-1"] },
            evidenceReview: { reason: "每句均有直接证据。", unsupportedSentenceIds: [], verdict: "pass" },
            model: { id: "gpt-5-mini", provider: "openai" },
            qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
            version: "liteasy.thin-reading-agent/v1"
          },
          paperEvidence: ["evidence-1"]
        },
        omittedSections: [],
        recommendations: [],
        summary: "A traceable summary with persisted audit provenance.",
        withinPaperClosure: true
      },
      targetLanguage: "en-US"
    });
    const forgedDocument = JSON.parse(JSON.stringify(document)) as typeof document;
    forgedDocument.nodes[forgedDocument.rootNodeId].evidence.generationAudit!.evidencePlan!.selectedEvidenceIds = ["evidence-forged"];
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [
          { artifactId: document.artifactId, thinReadingDocument: document, title: "Valid audit", type: "thin_reading" },
          { artifactId: "artifact-thin-audit-forged", thinReadingDocument: { ...forgedDocument, artifactId: "artifact-thin-audit-forged" }, title: "Forged audit", type: "thin_reading" }
        ],
        savedAt: "2026-07-29T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        artifactId: "artifact-thin-audit-cache",
        thinReadingDocument: expect.objectContaining({
          nodes: expect.objectContaining({
            [document.rootNodeId]: expect.objectContaining({
              evidence: expect.objectContaining({
                generationAudit: expect.objectContaining({
                  evidencePlan: { focus: ["核心贡献"], selectedEvidenceIds: ["evidence-1"] }
                })
              })
            })
          })
        })
      })
    ]);
  });

  test("preserves matching selected-passage evidence scope and rejects a mismatched cache", async () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-thin-selected-scope",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: {
          externalKnowledge: [],
          externalSources: [{
            abstract: "A traceable external lead.",
            authors: ["A. Author"],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.8,
            retrievalQuery: "Paper one follow-up",
            sourceId: "W42",
            sourceRecordUrl: "https://openalex.org/W42",
            title: "A Follow-up Paper",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          paperEvidence: ["evidence-1"]
        },
        omittedSections: [],
        recommendations: [],
        summary: "Paper one uses an evidence-backed method.",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });
    const document = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-2"] },
        omittedSections: [],
        recommendations: [],
        summary: "The selected passage explains the method.",
        withinPaperClosure: true
      },
      source: {
        kind: "selected_text",
        evidenceIds: ["evidence-1"],
        externalSourceIds: ["openalex:W42"],
        excerpt: "The method preserves a matching signal."
      },
      title: "Method"
    });
    const child = document.nodes[document.activeNodeId];
    const mismatchedDocument = {
      ...document,
      artifactId: "artifact-thin-selected-scope-broken",
      nodes: {
        ...document.nodes,
        [child.id]: {
          ...child,
          recommendationScope: {
            ...child.recommendationScope,
            externalSourceIds: ["openalex:W99"]
          }
        }
      }
    };
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [
          { artifactId: document.artifactId, thinReadingDocument: document, title: "Thin reading", type: "thin_reading" },
          { artifactId: "artifact-thin-selected-scope-broken", thinReadingDocument: mismatchedDocument, title: "Broken", type: "thin_reading" }
        ],
        savedAt: "2026-07-28T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        artifactId: "artifact-thin-selected-scope",
        thinReadingDocument: expect.objectContaining({
          nodes: expect.objectContaining({
            [child.id]: expect.objectContaining({
              recommendationScope: expect.objectContaining({
                evidenceIds: ["evidence-1"],
                externalSourceIds: ["openalex:W42"]
              })
            })
          })
        })
      })
    ]);
  });

  test("rejects cached selected-passage evidence absent from the parent evidence boundary", async () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-thin-parent-evidence",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-parent"] },
        omittedSections: [],
        recommendations: [],
        summary: "A parent summary.",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });
    const document = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-child"] },
        omittedSections: [],
        recommendations: [],
        summary: "A child summary.",
        withinPaperClosure: true
      },
      source: {
        kind: "selected_text",
        evidenceIds: ["evidence-parent"],
        excerpt: "A supported parent passage."
      },
      title: "Detail"
    });
    const child = document.nodes[document.activeNodeId];
    const corrupted = {
      ...document,
      nodes: {
        ...document.nodes,
        [child.id]: {
          ...child,
          recommendationScope: {
            ...child.recommendationScope,
            evidenceIds: ["evidence-unknown"]
          },
          source: {
            ...child.source,
            evidenceIds: ["evidence-unknown"]
          }
        }
      }
    };
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [{ artifactId: document.artifactId, thinReadingDocument: corrupted, title: "Thin reading", type: "thin_reading" }],
        savedAt: "2026-07-28T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([]);
  });

  test("rejects cached sentence traces that cite an unavailable evidence or external source", async () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-invalid-sentence-trace",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: {
          paperEvidence: ["evidence-1"],
          externalKnowledge: [],
          paperEvidenceSpans: [{
            confidence: 0.9,
            id: "evidence-1",
            page: 2,
            pageTextEnd: 48,
            pageTextStart: 12,
            paperId: "paper-1",
            quote: "The method preserves the relevant signal."
          }],
          summarySentences: [{
            evidenceIds: ["evidence-forged"],
            externalKnowledge: [],
            id: "sentence-1",
            status: "grounded",
            text: "The method preserves the relevant signal."
          }]
        },
        omittedSections: [],
        recommendations: [],
        summary: "The method preserves the relevant signal.",
        withinPaperClosure: true
      },
      targetLanguage: "en-US"
    });
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [{ artifactId: document.artifactId, thinReadingDocument: document, title: "Thin reading", type: "thin_reading" }],
        savedAt: "2026-07-28T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([]);
  });

  test("rejects cached public annotation queues with an invalid target or visibility", async () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-annotation-validation",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: [] },
        omittedSections: [],
        recommendations: [],
        summary: "A recoverable thin-reading summary.",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });
    const invalidAnnotation = {
      artifactId: document.artifactId,
      body: "Broken annotation",
      createdAt: "2026-07-28T00:00:00.000Z",
      excerpt: "summary",
      id: "annotation-broken",
      nodeId: document.rootNodeId,
      target: { kind: "recommendation", nodeId: document.rootNodeId },
      updatedAt: "2026-07-28T00:00:00.000Z",
      visibility: "pending_public"
    };
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [{
          artifactId: document.artifactId,
          thinReadingDocument: {
            ...document,
            annotations: [invalidAnnotation],
            pendingPublicAnnotationIds: [invalidAnnotation.id]
          },
          title: "Thin reading",
          type: "thin_reading"
        }],
        savedAt: "2026-07-28T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([]);
  });

  test("migrates a legacy OpenAlex source record URL before restoring a thin-reading artifact", async () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-legacy-source",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: {
          externalKnowledge: ["openalex:W42"],
          externalSources: [{
            abstract: "A traceable external source.",
            authors: ["A. Author"],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.8,
            retrievalQuery: "follow-up research",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "Follow-up paper",
            url: "https://doi.org/10.1000/follow-up"
          }],
          paperEvidence: []
        },
        omittedSections: [],
        recommendations: [],
        summary: "A traceable external source extends this reading path.",
        withinPaperClosure: false
      },
      targetLanguage: "en-US"
    });
    const legacyDocument = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
    const nodes = legacyDocument.nodes as Record<string, { evidence: { externalSources: Array<Record<string, unknown>> } }>;
    delete nodes[legacyDocument.rootNodeId as string].evidence.externalSources[0].sourceRecordUrl;
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [{
          artifactId: "artifact-thin-legacy-source",
          thinReadingDocument: legacyDocument,
          title: "Thin reading",
          type: "thin_reading"
        }],
        savedAt: "2026-07-28T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    const [artifact] = await repository.list();
    expect(artifact.thinReadingDocument?.nodes[artifact.thinReadingDocument.rootNodeId]
      .evidence.externalSources?.[0].sourceRecordUrl).toBe("https://openalex.org/W42");
  });

  test("rejects cached external sources with an unverifiable OpenAlex record URL", async () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-invalid-source",
      papers: [{ id: "paper-1", title: "Paper one" }],
      rootSeed: {
        evidence: {
          externalKnowledge: ["openalex:W42"],
          externalSources: [{
            abstract: "A traceable external source.",
            authors: [],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.8,
            retrievalQuery: "follow-up research",
            sourceRecordUrl: "https://example.com/not-openalex",
            sourceId: "W42",
            title: "Follow-up paper",
            url: "https://doi.org/10.1000/follow-up"
          }],
          paperEvidence: []
        },
        omittedSections: [],
        recommendations: [],
        summary: "A traceable external source extends this reading path.",
        withinPaperClosure: false
      },
      targetLanguage: "en-US"
    });
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [{
          artifactId: "artifact-thin-invalid-source",
          thinReadingDocument: document,
          title: "Thin reading",
          type: "thin_reading"
        }],
        savedAt: "2026-07-28T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([]);
  });

  test("writes a versioned snapshot without transient skill documents", async () => {
    const save = vi.fn(async () => undefined);
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => null),
      save
    });

    await repository.replace([
      { artifactId: "artifact-1", title: "Tree", type: "tree" },
      { artifactId: "skill-doc-1", title: "Skill", type: "skill_doc" }
    ]);

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      artifacts: [{ artifactId: "artifact-1", title: "Tree", type: "tree" }],
      savedAt: expect.any(String),
      version: "liteasy.artifact-catalog/v1"
    }));
  });

  test("restores the browser fallback after the repository is recreated", async () => {
    const firstRepository = createArtifactLocalRepository();
    await firstRepository.replace([
      { artifactId: "artifact-browser", title: "Browser cached tree", type: "tree" }
    ]);

    const restoredRepository = createArtifactLocalRepository();
    await expect(restoredRepository.list()).resolves.toEqual([
      { artifactId: "artifact-browser", title: "Browser cached tree", type: "tree" }
    ]);
  });
});
