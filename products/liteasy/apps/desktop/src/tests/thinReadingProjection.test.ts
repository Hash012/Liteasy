import { describe, expect, test } from "vitest";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  applyThinReadingAnnotationSyncResults,
  advanceThinReadingDocument,
  createThinReadingDocument,
  listThinReadingBranchOptions,
  resolveThinReadingClosureState,
  resolveThinReadingSentenceSupportMode,
  resolveThinReadingSupportMode,
  updateThinReadingAnnotation
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

function aiSeed(overrides: Partial<ThinReadingNodeSeed> = {}): ThinReadingNodeSeed {
  return {
    evidence: {
      anchors: [],
      claims: [],
      externalKnowledge: [],
      externalSources: [],
      generationAudit: {
        aiInterpretationReview: {
          reason: "AI 独立理解审阅通过。",
          unsafeSentenceIds: [],
          verdict: "pass"
        },
        externalFallback: {
          attemptedRoutes: ["support"],
          carriedSourceCount: 0,
          completedRoutes: [],
          reason: "verification_exhausted",
          trustedSourceCount: 0
        },
        model: { id: "test-model", provider: "test" },
        qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
        version: "liteasy.thin-reading-agent/v2"
      },
      interactiveDemo: undefined,
      mermaid: "",
      paperEvidence: [],
      paperEvidenceSpans: [],
      recommendedFigures: [],
      summarySentences: [{
        evidenceIds: [],
        externalKnowledge: [],
        id: "sentence-1",
        status: "unsupported",
        supportMode: "ai_interpretation",
        text: "AI 的一种可能理解是，MaxSim 保留了细粒度匹配信号。"
      }]
    },
    omittedSections: [],
    recommendations: [],
    summary: "AI 的一种可能理解是，MaxSim 保留了细粒度匹配信号。",
    supportMode: "ai_interpretation",
    withinPaperClosure: false,
    ...overrides
  };
}

function mixedAnswerabilitySeed(): ThinReadingNodeSeed {
  const paperSentenceId = "sentence-paper-boundary";
  const externalSentenceId = "sentence-external-boundary";
  return {
    closureState: "near_boundary",
    evidence: {
      externalKnowledge: ["openalex:W424242"],
      externalSources: [{
        abstract: "Deployment constraints determine when the mechanism remains effective.",
        authors: ["A. Researcher"],
        id: "openalex:W424242",
        provider: "openalex",
        relation: "topic_search",
        relevance: 0.9,
        retrievalQuery: "deployment constraints",
        sourceId: "W424242",
        sourceRecordUrl: "https://openalex.org/W424242",
        title: "Deployment Constraints",
        url: "https://openalex.org/W424242"
      }],
      generationAudit: {
        evidenceReview: {
          paperAnswerability: {
            answerObligations: [{
              obligation: "解释目标论文中的机制",
              paperCoverage: "complete",
              paperEvidenceIds: ["evidence-1"],
              reason: "目标论文证据完整覆盖机制义务。"
            }, {
              obligation: "解释论文未研究的部署约束",
              paperCoverage: "none",
              paperEvidenceIds: [],
              reason: "该必要义务需要论文外来源。"
            }],
            paperSupportedSentenceIds: [paperSentenceId],
            reason: "论文能回答机制，但完整的部署边界需要论文外证据。",
            status: "partial"
          },
          reason: "论文句和外部句分别由其绑定来源直接支持。",
          unsupportedSentenceIds: [],
          verdict: "pass"
        },
        model: { id: "test-model", provider: "test" },
        paperAnswerabilityTransition: {
          answerObligations: [{
            obligation: "解释目标论文中的机制",
            paperCoverage: "complete",
            paperEvidenceIds: ["evidence-1"],
            reason: "目标论文证据完整覆盖机制义务。"
          }, {
            obligation: "解释论文未研究的部署约束",
            paperCoverage: "none",
            paperEvidenceIds: [],
            reason: "该必要义务需要论文外来源。"
          }],
          reason: "论文能回答机制，但完整的部署边界需要论文外证据。",
          status: "partial",
          targetSupportMode: "paper_and_external"
        },
        qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
        version: "liteasy.thin-reading-agent/v2"
      },
      paperEvidence: ["evidence-1"],
      summarySentences: [{
        evidenceIds: ["evidence-1"],
        externalKnowledge: [],
        id: paperSentenceId,
        status: "grounded",
        supportMode: "paper",
        text: "论文解释了该机制的内部工作方式。"
      }, {
        evidenceIds: [],
        externalKnowledge: ["openalex:W424242"],
        id: externalSentenceId,
        status: "weak",
        supportMode: "external_only",
        text: "外部研究补充了该机制的部署约束。"
      }]
    },
    omittedSections: [],
    recommendations: [],
    summary: "论文解释了该机制的内部工作方式。外部研究补充了该机制的部署约束。",
    supportMode: "paper_and_external",
    withinPaperClosure: false
  };
}

describe("thinReadingProjection", () => {
  test("resolves sentence support modes from sentence-level sources", () => {
    expect(resolveThinReadingSentenceSupportMode({
      evidenceIds: ["evidence-1"],
      externalKnowledge: ["openalex:W1"]
    })).toBe("paper_and_external");
    expect(resolveThinReadingSentenceSupportMode({
      evidenceIds: ["evidence-1"],
      externalKnowledge: []
    })).toBe("paper");
    expect(resolveThinReadingSentenceSupportMode({
      evidenceIds: [],
      externalKnowledge: ["openalex:W1"]
    })).toBe("external_only");
    expect(resolveThinReadingSentenceSupportMode({
      evidenceIds: [],
      externalKnowledge: [],
      supportMode: "ai_interpretation"
    })).toBe("ai_interpretation");
  });

  test("resolves four support modes without treating a legacy empty node as AI interpretation", () => {
    expect(resolveThinReadingSupportMode({
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] }
    })).toBe("paper");
    expect(resolveThinReadingSupportMode({
      evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: ["evidence-1"] }
    })).toBe("paper_and_external");
    expect(resolveThinReadingSupportMode({
      evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: [] }
    })).toBe("external_only");
    expect(resolveThinReadingSupportMode({
      evidence: { externalKnowledge: [], paperEvidence: [] }
    })).toBe("paper");
    expect(resolveThinReadingSupportMode({
      evidence: aiSeed().evidence,
      supportMode: "ai_interpretation"
    })).toBe("ai_interpretation");
  });

  test("prefers explicit sentence mappings over unused root-level source markers", () => {
    const paperSentence = {
      evidenceIds: ["evidence-1"],
      externalKnowledge: [],
      id: "sentence-paper",
      status: "grounded" as const,
      supportMode: "paper" as const,
      text: "The target paper directly supports this sentence."
    };

    expect(resolveThinReadingSupportMode({
      evidence: {
        externalKnowledge: ["openalex:W-unused"],
        paperEvidence: ["evidence-1"],
        summarySentences: [paperSentence]
      }
    })).toBe("paper");
    expect(() => resolveThinReadingSupportMode({
      evidence: {
        externalKnowledge: ["openalex:W-unused"],
        paperEvidence: ["evidence-1"],
        summarySentences: [paperSentence]
      },
      supportMode: "paper_and_external"
    })).toThrow("薄读支持模式与正文来源不一致");

    expect(() => resolveThinReadingSupportMode({
      evidence: {
        externalKnowledge: ["openalex:W1"],
        paperEvidence: ["evidence-unused"],
        summarySentences: [{
          evidenceIds: [],
          externalKnowledge: ["openalex:W1"],
          id: "sentence-external",
          status: "weak",
          supportMode: "external_only",
          text: "A traceable external source supports this sentence."
        }]
      },
      supportMode: "external_only"
    })).toThrow("external_only 不能携带论文证据");
  });

  test("persists explicit support modes on root and child nodes", () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-support-mode",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: seed({ supportMode: "paper" }),
      targetLanguage: "zh-CN"
    });
    const child = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: seed({
        evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: [] },
        supportMode: "external_only",
        withinPaperClosure: false
      }),
      source: { kind: "omitted_section", label: "后续", sectionKey: "follow_up" },
      title: "后续"
    });

    expect(root.nodes[root.rootNodeId].supportMode).toBe("paper");
    expect(child.nodes[child.activeNodeId].supportMode).toBe("external_only");
  });

  test("persists and freezes the semantic partial-to-mixed transition", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-answerability-transition",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: mixedAnswerabilitySeed(),
      targetLanguage: "zh-CN"
    });
    const root = document.nodes[document.rootNodeId];
    const transition = root.evidence.generationAudit?.paperAnswerabilityTransition;

    expect(root).toMatchObject({
      closureState: "near_boundary",
      supportMode: "paper_and_external",
      withinPaperClosure: false
    });
    expect(transition).toEqual({
      answerObligations: [{
        obligation: "解释目标论文中的机制",
        paperCoverage: "complete",
        paperEvidenceIds: ["evidence-1"],
        reason: "目标论文证据完整覆盖机制义务。"
      }, {
        obligation: "解释论文未研究的部署约束",
        paperCoverage: "none",
        paperEvidenceIds: [],
        reason: "该必要义务需要论文外来源。"
      }],
      reason: "论文能回答机制，但完整的部署边界需要论文外证据。",
      status: "partial",
      targetSupportMode: "paper_and_external"
    });
    expect(Object.isFrozen(transition)).toBe(true);
    expect(Object.isFrozen(transition?.answerObligations)).toBe(true);
    expect(Object.isFrozen(transition?.answerObligations?.[0])).toBe(true);
    expect(Object.isFrozen(transition?.answerObligations?.[0].paperEvidenceIds)).toBe(true);
    const reviewObligations = root.evidence.generationAudit?.evidenceReview?.paperAnswerability
      ?.answerObligations;
    expect(Object.isFrozen(reviewObligations)).toBe(true);
    expect(Object.isFrozen(reviewObligations?.[0])).toBe(true);
    expect(Object.isFrozen(reviewObligations?.[0].paperEvidenceIds)).toBe(true);
  });

  test("rejects a paper-answerability transition that disagrees with final sources", () => {
    const valid = mixedAnswerabilitySeed();
    expect(() => createThinReadingDocument({
      artifactId: "artifact-answerability-mismatch",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: {
        ...valid,
        evidence: {
          ...valid.evidence,
          generationAudit: {
            ...valid.evidence.generationAudit!,
            evidenceReview: undefined,
            paperAnswerabilityTransition: {
              reason: "错误地声称论文完全不能回答当前问题。",
              status: "none",
              targetSupportMode: "external_only"
            }
          }
        }
      },
      targetLanguage: "zh-CN"
    })).toThrow("转档审计与最终句级来源不一致");
  });

  test("rejects AI interpretation declarations that conflict with evidence or lack fallback audit", () => {
    expect(() => resolveThinReadingSupportMode({
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
      supportMode: "ai_interpretation"
    })).toThrow("薄读支持模式与正文来源不一致");
    expect(() => resolveThinReadingSupportMode({
      evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: [] },
      supportMode: "ai_interpretation"
    })).toThrow("薄读支持模式与正文来源不一致");
    expect(() => createThinReadingDocument({
      artifactId: "artifact-ai-without-audit",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: seed({
        evidence: { externalKnowledge: [], paperEvidence: [] },
        supportMode: "ai_interpretation",
        withinPaperClosure: false
      }),
      targetLanguage: "zh-CN"
    })).toThrow("AI 理解节点缺少外部检索兜底审计");
  });

  test("rejects contaminated AI interpretation seeds on root and child persistence", () => {
    expect(() => createThinReadingDocument({
      artifactId: "artifact-ai-root-contaminated",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: aiSeed({
        evidence: {
          ...aiSeed().evidence,
          paperEvidence: ["evidence-1"]
        }
      }),
      targetLanguage: "zh-CN"
    })).toThrow("AI 理解不能携带论文或外部引用");

    const root = createThinReadingDocument({
      artifactId: "artifact-ai-child-contaminated-base",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });

    expect(() => advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: aiSeed({ withinPaperClosure: true }),
      source: { kind: "omitted_section", label: "后续", sectionKey: "follow_up" },
      title: "后续"
    })).toThrow("AI 理解节点必须越出论文闭包");
  });

  test("persists and freezes valid AI interpretation seeds on root and child nodes", () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-ai-valid-root",
      papers: [{ id: "paper-1", title: "Paper" }],
      rootSeed: aiSeed(),
      targetLanguage: "zh-CN"
    });
    const child = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: aiSeed(),
      source: { kind: "omitted_section", label: "后续", sectionKey: "follow_up" },
      title: "后续"
    });

    expect(root.nodes[root.rootNodeId]).toMatchObject({
      supportMode: "ai_interpretation",
      withinPaperClosure: false,
      evidence: {
        anchors: [],
        externalKnowledge: [],
        externalSources: [],
        generationAudit: {
          aiInterpretationReview: {
            reason: "AI 独立理解审阅通过。",
            unsafeSentenceIds: [],
            verdict: "pass"
          },
          externalFallback: {
            attemptedRoutes: ["support"],
            completedRoutes: [],
            reason: "verification_exhausted",
            trustedSourceCount: 0
          }
        },
        mermaid: "",
        paperEvidence: [],
        paperEvidenceSpans: [],
        recommendedFigures: [],
        summarySentences: [expect.objectContaining({
          evidenceIds: [],
          externalKnowledge: [],
          status: "unsupported",
          supportMode: "ai_interpretation"
        })]
      }
    });
    expect(child.nodes[child.activeNodeId]).toMatchObject({
      supportMode: "ai_interpretation",
      withinPaperClosure: false,
      evidence: {
        externalKnowledge: [],
        externalSources: [],
        paperEvidence: [],
        recommendedFigures: [],
        summarySentences: [expect.objectContaining({
          evidenceIds: [],
          externalKnowledge: [],
          status: "unsupported",
          supportMode: "ai_interpretation"
        })]
      }
    });
    expect(Object.isFrozen(root.nodes[root.rootNodeId].evidence.externalSources)).toBe(true);
    expect(Object.isFrozen(child.nodes[child.activeNodeId].evidence.externalSources)).toBe(true);
    expect(Object.isFrozen(child.nodes[child.activeNodeId].evidence.generationAudit?.externalFallback)).toBe(true);
    expect(Object.isFrozen(child.nodes[child.activeNodeId].evidence.summarySentences)).toBe(true);
  });

  test("derives the paper answerability boundary from final support rather than topology depth", () => {
    expect(resolveThinReadingClosureState({ depth: 0, supportMode: "paper", withinPaperClosure: true })).toBe("inside_paper");
    expect(resolveThinReadingClosureState({ depth: 8, supportMode: "paper", withinPaperClosure: true })).toBe("inside_paper");
    expect(resolveThinReadingClosureState({
      depth: 1,
      supportMode: "paper_and_external",
      withinPaperClosure: false
    })).toBe("near_boundary");
    expect(resolveThinReadingClosureState({
      depth: 1,
      supportMode: "external_only",
      withinPaperClosure: false
    })).toBe("outside_paper");
    expect(resolveThinReadingClosureState({
      closureState: "near_boundary",
      depth: 1,
      supportMode: "paper_and_external",
      withinPaperClosure: false
    })).toBe("near_boundary");
  });

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
      version: "liteasy.thin-reading/v2"
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
              pageTextEnd: 20,
              pageTextStart: 0,
              paperId: "paper-1",
              quote: "ColBERT uses MaxSim."
            }
          ],
          summarySentences: [
            {
              evidenceIds: ["evidence-1"],
              externalKnowledge: [],
              id: "sentence-1",
              status: "grounded",
              text: "MaxSim 保留 token-level matching signals。"
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
      pageTextEnd: 20,
      pageTextStart: 0,
      quote: "ColBERT uses MaxSim."
    });
    expect(root.evidence.summarySentences?.[0]).toMatchObject({
      evidenceIds: ["evidence-1"],
      status: "grounded",
      text: "MaxSim 保留 token-level matching signals。"
    });
  });

  test("freezes optional anchor quality and page-wide recommendation edges", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-graph-metadata",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        evidence: {
          anchors: [{
            end: 6,
            evidenceIds: ["evidence-1"],
            externalSourceIds: ["openalex:W1"],
            id: "anchor-1",
            importance: 0.9,
            kind: "method",
            quality: {
              citationProvenance: 1,
              evidenceAttention: 0.5,
              evidenceCoverage: 0.75,
              reason: "核心方法 · 3 条证据 · 原文有引用",
              score: 0.81
            },
            searchQuery: "MaxSim late interaction",
            start: 0,
            summarySentenceId: "sentence-1",
            text: "MaxSim"
          }],
          externalKnowledge: [],
          paperEvidence: ["evidence-1"],
          recommendationPaperEdges: [{
            directed: true,
            evidenceRecordUrls: ["https://openalex.org/W2"],
            kind: "direct_citation",
            provider: "openalex",
            sourcePaperId: "openalex:W1",
            strength: 0.9,
            targetPaperId: "openalex:W2"
          }]
        }
      }),
      targetLanguage: "zh-CN"
    });
    const root = document.nodes[document.rootNodeId];

    expect(root.evidence.anchors?.[0]?.quality).toEqual({
      citationProvenance: 1,
      evidenceAttention: 0.5,
      evidenceCoverage: 0.75,
      reason: "核心方法 · 3 条证据 · 原文有引用",
      score: 0.81
    });
    expect(root.evidence.recommendationPaperEdges).toEqual([{
      directed: true,
      evidenceRecordUrls: ["https://openalex.org/W2"],
      kind: "direct_citation",
      provider: "openalex",
      sourcePaperId: "openalex:W1",
      strength: 0.9,
      targetPaperId: "openalex:W2"
    }]);
    expect(Object.isFrozen(root.evidence.anchors?.[0]?.quality)).toBe(true);
    expect(Object.isFrozen(root.evidence.recommendationPaperEdges)).toBe(true);
    expect(Object.isFrozen(root.evidence.recommendationPaperEdges?.[0])).toBe(true);
    expect(Object.isFrozen(root.evidence.recommendationPaperEdges?.[0]?.evidenceRecordUrls)).toBe(true);
  });

  test("keeps legacy thin-reading artifacts valid without graph metadata", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-legacy",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        evidence: {
          anchors: [{
            end: 6,
            evidenceIds: ["evidence-1"],
            externalSourceIds: [],
            id: "anchor-1",
            importance: 0.9,
            kind: "method",
            label: "MaxSim",
            searchQuery: "MaxSim late interaction",
            start: 0,
            summarySentenceId: "sentence-1",
            text: "MaxSim"
          } as unknown as ThinReadingNodeSeed["evidence"]["anchors"][number]],
          externalKnowledge: [],
          paperEvidence: ["evidence-1"]
        }
      }),
      targetLanguage: "zh-CN"
    });
    const root = document.nodes[document.rootNodeId];

    expect(root.evidence.anchors?.[0]?.quality).toBeUndefined();
    expect(root.evidence.anchors?.[0]).not.toHaveProperty("label");
    expect(root.evidence.anchors?.[0]).toEqual(expect.objectContaining({
      id: "anchor-1",
      externalSourceIds: [],
      text: "MaxSim"
    }));
    expect(root.evidence.recommendationPaperEdges).toBeUndefined();
  });

  test("persists and freezes the evidence-planning quality audit on root and branch nodes", () => {
    const audit = {
      aiInterpretationReview: {
        reason: "最终正文保持明确披露的概念推理边界。",
        unsafeSentenceIds: [],
        verdict: "pass" as const
      },
      evidenceLoop: {
        rounds: [{
          focus: ["核心结论"],
          observedEvidenceIds: ["evidence-1"],
          pageRequests: [],
          round: 1,
          searchQueries: [],
          selectedEvidenceIds: ["evidence-1"],
          toolCalls: [{ evidenceIds: ["evidence-1"], kind: "read" as const }]
        }],
        stopReason: "observation_sufficient" as const,
        stopReasonDetail: "首轮证据已足以支撑核心结论。"
      },
      evidencePlan: { focus: ["核心结论"], selectedEvidenceIds: ["evidence-1"] },
      evidencePlanning: {
        mode: "model" as const,
        normalization: {
          deduplicated: { focus: 0, pageRequests: 0, searchQueries: 0, selectedEvidenceIds: 0 },
          truncated: { focus: 0, pageRequests: 1, searchQueries: 0, selectedEvidenceIds: 0 }
        },
        repairApplied: false,
        selectedEvidenceIds: ["evidence-1"]
      },
      evidenceReview: {
        contentQuality: {
          depthFit: "appropriate" as const,
          focus: "focused" as const,
          intentAlignment: "aligned" as const,
          logicChain: "complete" as const,
          reason: "主意图、逻辑链和拓扑深度匹配。",
          revisionSentenceIds: [],
          severity: "none" as const,
          verdict: "pass" as const
        },
        reason: "句子均由限定证据支持。",
        rootOrientation: {
          conclusionSupport: {
            chains: [{
              conclusionSentenceId: "sentence-audit",
              reason: "机制句直接说明核心结论成立的关键过程。",
              supportKinds: ["mechanism" as const],
              supportSentenceIds: ["sentence-audit"],
              verdict: "complete" as const
            }],
            reason: "核心结论具有最短充分的机制支持过程。",
            status: "complete" as const
          },
          coreIdea: "covered" as const,
          fieldPosition: "evidence_unavailable" as const,
          paperPanorama: "covered" as const,
          paperType: "experimental" as const,
          paperTypeVerdict: "supported" as const,
          reason: "总述保留核心结论、支持过程和适用边界。",
          retentionVerdict: "focused" as const,
          verdict: "pass" as const
        },
        unsupportedSentenceIds: [],
        verdict: "pass" as const
      },
      interpretationPlan: {
        discourseMoves: ["建立核心思想", "展开全景", "定位领域位置"],
        explanationDepth: "overview" as const,
        externalKnowledgeNeeded: false,
        intent: "mixed" as const,
        intentSignals: ["root_orientation:experimental"],
        intentWeights: { how: 0.25, what: 0.4, why: 0.35 },
        learningGoals: ["core_idea", "paper_panorama", "field_position"] as const,
        paperTypeHint: "experimental" as const,
        readingMode: "orientation" as const,
        retentionFocus: ["核心结论", "关键推导", "领域位置"],
        requestedDepth: "standard" as const
      },
      model: { id: "gpt-5-mini", provider: "openai" },
      paperEvidenceRecovery: {
        addedEvidenceIds: ["evidence-2"],
        answerObligations: ["补齐结论成立边界"],
        finalAnswerability: "partial" as const,
        initialEvidenceIds: ["evidence-1"],
        status: "exhausted" as const
      },
      qualityGate: { attempts: 2, repaired: true, repairReasons: ["首次句级映射不完整"] },
      version: "liteasy.thin-reading-agent/v2" as const
    };
    const rootDocument = createThinReadingDocument({
      artifactId: "artifact-thin-audit",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        evidence: {
          externalKnowledge: [],
          generationAudit: audit,
          paperEvidence: ["evidence-1"],
          summarySentences: [{
            evidenceIds: ["evidence-1"],
            externalKnowledge: [],
            id: "sentence-audit",
            status: "grounded",
            text: "ColBERT 的核心结论由 MaxSim 机制直接支持。"
          }]
        }
      }),
      targetLanguage: "zh-CN"
    });
    const branched = advanceThinReadingDocument(rootDocument, {
      parentNodeId: rootDocument.rootNodeId,
      seed: seed({
        evidence: {
          externalKnowledge: [],
          generationAudit: audit,
          paperEvidence: ["evidence-1"],
          summarySentences: [{
            evidenceIds: ["evidence-1"],
            externalKnowledge: [],
            id: "sentence-audit",
            status: "grounded",
            text: "ColBERT 的核心结论由 MaxSim 机制直接支持。"
          }]
        }
      }),
      source: { evidenceIds: ["evidence-1"], excerpt: "MaxSim", kind: "selected_text" },
      title: "MaxSim"
    });
    const rootAudit = branched.nodes[branched.rootNodeId].evidence.generationAudit;
    const branchAudit = branched.nodes[branched.activeNodeId].evidence.generationAudit;

    expect(rootAudit).toEqual(audit);
    expect(branchAudit).toEqual(audit);
    expect(Object.isFrozen(branchAudit?.aiInterpretationReview)).toBe(true);
    expect(Object.isFrozen(branchAudit?.aiInterpretationReview?.unsafeSentenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.qualityGate.repairReasons)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidencePlan?.selectedEvidenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidencePlanning)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidencePlanning?.normalization?.truncated)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidencePlanning?.selectedEvidenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.interpretationPlan?.learningGoals)).toBe(true);
    expect(Object.isFrozen(branchAudit?.interpretationPlan?.intentSignals)).toBe(true);
    expect(Object.isFrozen(branchAudit?.interpretationPlan?.intentWeights)).toBe(true);
    expect(Object.isFrozen(branchAudit?.interpretationPlan?.retentionFocus)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceReview?.contentQuality)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceReview?.contentQuality?.revisionSentenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceReview?.rootOrientation?.conclusionSupport)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceReview?.rootOrientation?.conclusionSupport.chains)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceReview?.rootOrientation?.conclusionSupport.chains[0].supportKinds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceReview?.rootOrientation?.conclusionSupport.chains[0].supportSentenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.paperEvidenceRecovery)).toBe(true);
    expect(Object.isFrozen(branchAudit?.paperEvidenceRecovery?.addedEvidenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.paperEvidenceRecovery?.answerObligations)).toBe(true);
    expect(Object.isFrozen(branchAudit?.paperEvidenceRecovery?.initialEvidenceIds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceLoop?.rounds)).toBe(true);
    expect(Object.isFrozen(branchAudit?.evidenceLoop?.rounds[0].toolCalls[0].evidenceIds)).toBe(true);
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
        recommendations: [],
        summary: "ColBERT keeps contextualized token embeddings and uses MaxSim for late interaction."
      }),
      targetLanguage: "en-US"
    });
    const root = document.nodes[document.rootNodeId];

    expect(root.omittedSections.map((token) => token.label)).toEqual(["Experiments"]);
    expect(root.recommendations).toEqual([]);
    expect(root.summary).toContain("ColBERT keeps contextualized token embeddings");
    expect(root.summary).not.toMatch(/围绕|薄读|可用上下文/);
  });

  test("filters legacy local recommendation leads from new thin-reading documents", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-local-lead",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed({
        recommendations: [{
          compatibility: 0.84,
          id: "legacy-local-lead",
          note: "模型生成的本地联想。",
          relationship: "方法与问题设定",
          source: "local_agent_lead"
        }]
      })
    });

    expect(document.nodes[document.rootNodeId].recommendations).toEqual([]);
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

  test("freezes selected-text evidence ids with the persisted branch", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-selected-source",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });
    const evidenceIds = ["evidence-1"];
    const externalSourceIds = ["openalex:W42"];
    const next = advanceThinReadingDocument(document, {
      parentNodeId: document.rootNodeId,
      seed: seed(),
      source: {
        kind: "selected_text",
        evidenceIds,
        externalSourceIds,
        excerpt: "MaxSim preserves the strongest token-level match."
      },
      title: "MaxSim"
    });
    evidenceIds.push("mutated-after-persist");
    externalSourceIds.push("mutated-after-persist");
    const child = next.nodes[next.activeNodeId];

    expect(child.source).toMatchObject({
      kind: "selected_text",
      evidenceIds: ["evidence-1"],
      externalSourceIds: ["openalex:W42"]
    });
    expect(child.recommendationScope).toMatchObject({
      kind: "selected_passage",
      evidenceIds: ["evidence-1"],
      externalSourceIds: ["openalex:W42"]
    });
    expect(Object.isFrozen((child.source as Extract<typeof child.source, { kind: "selected_text" }>).evidenceIds)).toBe(true);
    expect(Object.isFrozen((child.source as Extract<typeof child.source, { kind: "selected_text" }>).externalSourceIds)).toBe(true);
  });

  test("drops executable legacy evidence while retaining model-selected MinerU figures", () => {
    const visualSeed = seed();
    visualSeed.evidence = {
      ...visualSeed.evidence,
      interactiveDemo: {
        description: "拖动滑块观察匹配得分",
        html: "<!doctype html><html><body><input type=range><script>location='https://attacker.example'</script></body></html>",
        kind: "html",
        title: "MaxSim 动画"
      },
      mermaid: "flowchart LR\nA[查询] --> B[MaxSim] --> C[得分]",
      recommendedFigures: [{
        evidenceIds: ["evidence-1"],
        figureId: "paper-1:figure-2",
        reason: "该图直接展示 token 级匹配关系"
      }]
    };
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-visuals",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: visualSeed,
      targetLanguage: "zh-CN"
    });
    const evidence = document.nodes[document.rootNodeId].evidence;

    expect(evidence).not.toHaveProperty("mermaid");
    expect(evidence).not.toHaveProperty("interactiveDemo");
    expect(evidence.recommendedFigures).toEqual([expect.objectContaining({
      figureId: "paper-1:figure-2",
      evidenceIds: ["evidence-1"]
    })]);
    expect(Object.isFrozen(evidence.interactiveDemo)).toBe(true);
    expect(Object.isFrozen(evidence.recommendedFigures)).toBe(true);
    expect(Object.isFrozen(evidence.recommendedFigures?.[0]?.evidenceIds)).toBe(true);
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

  test("persists a verified Intuecho receipt and requeues an edited public annotation", () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-thin-sync-receipt",
      papers: [{ doi: "10.1000/example", id: "paper-1", title: "ColBERT" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });
    const pending = addThinReadingAnnotation(root, {
      body: "需要同步的理解。",
      excerpt: "MaxSim",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const annotationId = pending.annotations[0].id;
    const synced = applyThinReadingAnnotationSyncResults(pending, [{
      annotationId,
      intuechoAnnotationId: "intuecho-123",
      status: "synced",
      syncedAt: "2026-07-28T02:00:00.000Z"
    }]);

    expect(synced.pendingPublicAnnotationIds).toEqual([]);
    expect(synced.annotations[0].syncState).toEqual({
      intuechoAnnotationId: "intuecho-123",
      status: "synced",
      syncedAt: "2026-07-28T02:00:00.000Z"
    });

    const edited = updateThinReadingAnnotation(synced, annotationId, "修改后需要重新同步的理解。");
    expect(edited.pendingPublicAnnotationIds).toEqual([annotationId]);
    expect(edited.annotations[0].syncState).toBeUndefined();
  });

  test("keeps failed Intuecho sync in the pending queue with a retryable error", () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-thin-sync-failure",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });
    const pending = addThinReadingAnnotation(root, {
      body: "待重试。",
      excerpt: "MaxSim",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const annotationId = pending.annotations[0].id;
    const failed = applyThinReadingAnnotationSyncResults(pending, [{
      annotationId,
      error: "Intuecho 同步请求失败（HTTP 503）。",
      status: "failed"
    }], "2026-07-28T03:00:00.000Z");

    expect(failed.pendingPublicAnnotationIds).toEqual([annotationId]);
    expect(failed.annotations[0].syncState).toEqual({
      error: "Intuecho 同步请求失败（HTTP 503）。",
      lastAttemptAt: "2026-07-28T03:00:00.000Z",
      status: "failed"
    });
  });

  test("does not let a stale Intuecho receipt overwrite a later edit or confirmed receipt", () => {
    const root = createThinReadingDocument({
      artifactId: "artifact-thin-sync-stale-receipt",
      papers: [{ doi: "10.1000/example", id: "paper-1", title: "ColBERT" }],
      rootSeed: seed(),
      targetLanguage: "zh-CN"
    });
    const pending = addThinReadingAnnotation(root, {
      body: "首次提交的理解。",
      createdAt: "2026-07-28T00:00:00.000Z",
      excerpt: "MaxSim",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const annotationId = pending.annotations[0].id;
    const edited = updateThinReadingAnnotation(pending, annotationId, "编辑后需要重新提交的理解。");
    const staleResult = [{
      annotationId,
      intuechoAnnotationId: "intuecho-stale",
      status: "synced" as const,
      syncedAt: "2026-07-28T02:00:00.000Z"
    }];

    const afterEdit = applyThinReadingAnnotationSyncResults(
      edited,
      staleResult,
      "2026-07-28T02:00:00.000Z",
      new Map([[annotationId, pending.annotations[0].updatedAt]])
    );
    expect(afterEdit.annotations[0]).toMatchObject({ body: "编辑后需要重新提交的理解。", visibility: "pending_public" });
    expect(afterEdit.annotations[0].syncState).toBeUndefined();

    const confirmed = applyThinReadingAnnotationSyncResults(pending, staleResult);
    const afterLateFailure = applyThinReadingAnnotationSyncResults(confirmed, [{
      annotationId,
      error: "Intuecho 同步请求失败（HTTP 503）。",
      status: "failed" as const
    }]);
    expect(afterLateFailure.annotations[0].syncState).toEqual({
      intuechoAnnotationId: "intuecho-stale",
      status: "synced",
      syncedAt: "2026-07-28T02:00:00.000Z"
    });
  });
});
