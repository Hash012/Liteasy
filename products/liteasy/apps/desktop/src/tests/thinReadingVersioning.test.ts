import { expect, test } from "vitest";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import {
  cloneThinReadingV1AsV2,
  parseThinReadingDocument
} from "../app/features/thin-reading/thinReadingVersioning";
import { branchInput, now, v1Fixture } from "./fixtures/thinReadingVersionFixtures";

function createMixedBoundaryDocument() {
  const paperSentenceId = "thin-reading-sentence-paper-boundary";
  return createThinReadingDocument({
    artifactId: "thin-answerability-boundary",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
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
          qualityGate: { attempts: 2, repaired: false, repairReasons: [] },
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
          id: "thin-reading-sentence-external-boundary",
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
    },
    targetLanguage: "zh-CN"
  });
}

test("reopens a sentence-mapped paper node without promoting an unused external marker", () => {
  const document = createThinReadingDocument({
    artifactId: "thin-unused-external-marker",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: {
        externalKnowledge: ["openalex:W424242"],
        externalSources: [{
          abstract: "An unused but traceable adjacent source.",
          authors: ["A. Researcher"],
          id: "openalex:W424242",
          provider: "openalex",
          relation: "topic_search",
          relevance: 0.9,
          retrievalQuery: "adjacent topic",
          sourceId: "W424242",
          sourceRecordUrl: "https://openalex.org/W424242",
          title: "Adjacent Topic",
          url: "https://openalex.org/W424242"
        }],
        paperEvidence: ["evidence-1"],
        summarySentences: [{
          evidenceIds: ["evidence-1"],
          externalKnowledge: [],
          id: "sentence-paper-only",
          status: "grounded",
          supportMode: "paper",
          text: "The target paper directly supports this sentence."
        }]
      },
      omittedSections: [],
      recommendations: [],
      summary: "The target paper directly supports this sentence.",
      supportMode: "paper",
      withinPaperClosure: true
    },
    targetLanguage: "en-US"
  });

  expect(parseThinReadingDocument(document).nodes[document.rootNodeId].supportMode).toBe("paper");
});

test("rejects persisted external-only nodes contaminated by root paper evidence", () => {
  const externalSource = {
    abstract: "A traceable external answer.",
    authors: ["A. Researcher"],
    id: "openalex:W424242",
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.9,
    retrievalQuery: "external answer",
    sourceId: "W424242",
    sourceRecordUrl: "https://openalex.org/W424242",
    title: "External Answer",
    url: "https://openalex.org/W424242"
  };
  const document = createThinReadingDocument({
    artifactId: "thin-external-only-contamination",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: {
        externalKnowledge: [externalSource.id],
        externalSources: [externalSource],
        paperEvidence: [],
        summarySentences: [{
          evidenceIds: [],
          externalKnowledge: [externalSource.id],
          id: "sentence-external-only",
          status: "weak",
          supportMode: "external_only",
          text: "A traceable external source supports this sentence."
        }]
      },
      omittedSections: [],
      recommendations: [],
      summary: "A traceable external source supports this sentence.",
      supportMode: "external_only",
      withinPaperClosure: false
    },
    targetLanguage: "en-US"
  });
  const root = document.nodes[document.rootNodeId];

  expect(() => parseThinReadingDocument({
    ...document,
    nodes: {
      ...document.nodes,
      [document.rootNodeId]: {
        ...root,
        evidence: { ...root.evidence, paperEvidence: ["evidence-contamination"] }
      }
    }
  })).toThrow("thin_reading_document_invalid");
});

test("parses v1 for display but refuses an in-place branch mutation", () => {
  const oldDocument = parseThinReadingDocument(v1Fixture);

  expect(oldDocument.version).toBe("liteasy.thin-reading/v1");
  expect(() => advanceThinReadingDocument(oldDocument, branchInput))
    .toThrow("thin_reading_v1_read_only");
});

test("clones v1 into a new v2 artifact before deepening", () => {
  const next = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-1", createdAt: now });

  expect(next.version).toBe("liteasy.thin-reading/v2");
  expect(next.artifactId).toBe("thin-copy-1");
  expect(next.nodes[next.rootNodeId].visualizations).toEqual([]);
  expect(next.nodes[next.rootNodeId].evidence).not.toHaveProperty("interactiveDemo");
  expect(next.nodes[next.rootNodeId].evidence).not.toHaveProperty("mermaid");
  expect(next.nodes[next.rootNodeId]).not.toHaveProperty("version");
  expect(next.migrationProvenance).toEqual({
    migratedAt: now,
    sourceArtifactId: "thin-v1-original"
  });
});

test("rejects a persisted deep-dive child whose source figure is no longer recommended by its parent", () => {
  const document = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-target", createdAt: now });
  const next = advanceThinReadingDocument(document, {
    ...branchInput,
    parentNodeId: document.rootNodeId,
    source: {
      kind: "visualization_target",
      target: {
        evidenceIds: ["evidence-1"],
        kind: "source_figure",
        nodeId: document.rootNodeId,
        sourceFigureId: "stale-figure"
      }
    }
  });

  expect(() => parseThinReadingDocument(next)).toThrow("thin_reading_document_invalid");
});

test("rejects v2 documents that retain executable legacy evidence or malformed visualizations", () => {
  const next = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-2", createdAt: now });
  const root = next.nodes[next.rootNodeId];

  expect(() => parseThinReadingDocument({
    ...next,
    nodes: {
      ...next.nodes,
      [next.rootNodeId]: {
        ...root,
        evidence: { ...root.evidence, mermaid: "flowchart LR\nA-->B" }
      }
    }
  })).toThrow("thin_reading_document_invalid");

  expect(() => parseThinReadingDocument({
    ...next,
    nodes: {
      ...next.nodes,
      [next.rootNodeId]: { ...root, visualizations: [{}] }
    }
  })).toThrow("thin_reading_document_invalid");
});

test("creates v2 documents without executable legacy evidence", () => {
  const document = createThinReadingDocument({
    artifactId: "thin-new-v2",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
      omittedSections: [],
      recommendations: [],
      summary: "A safe new document.",
      withinPaperClosure: true
    },
    targetLanguage: "en-US"
  });

  expect(document.version).toBe("liteasy.thin-reading/v2");
  expect(document.nodes[document.rootNodeId].visualizations).toEqual([]);
});

test("reloads persisted composition planning and a bounded three-attempt quality repair", () => {
  const sentenceId = "thin-reading-sentence-persisted";
  const document = createThinReadingDocument({
    artifactId: "thin-composition-audit",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: {
        externalKnowledge: [],
        generationAudit: {
          evidenceReview: {
            contentQuality: {
              depthFit: "appropriate",
              focus: "focused",
              intentAlignment: "aligned",
              logicChain: "complete",
              reason: "总述保留了核心结论、关键推导和领域位置。",
              revisionSentenceIds: [],
              severity: "none",
              verdict: "pass"
            },
            propositionVerdicts: [{
              proposition: "论文给出核心结论并说明成立边界",
              sentenceId,
              verdict: "supported"
            }],
            reason: "正文句由限定证据直接支持。",
            rootOrientation: {
              conclusionSupport: {
                chains: [{
                  conclusionSentenceId: sentenceId,
                  reason: "同一句同时给出核心结论及其成立边界。",
                  supportKinds: ["boundary"],
                  supportSentenceIds: [sentenceId],
                  verdict: "complete"
                }],
                reason: "核心结论具有明确的成立边界支持。",
                status: "complete"
              },
              coreIdea: "covered",
              fieldPosition: "evidence_unavailable",
              paperPanorama: "covered",
              paperType: "experimental",
              paperTypeVerdict: "supported",
              reason: "总述围绕核心结论及其成立边界组织。",
              retentionVerdict: "focused",
              verdict: "pass"
            },
            unsupportedSentenceIds: [],
            verdict: "pass"
          },
          evidencePlan: {
            focus: ["核心结论", "成立边界"],
            selectedEvidenceIds: ["evidence-1", "evidence-planned-but-unused"]
          },
          evidencePlanning: {
            mode: "deterministic_fallback",
            reason: "format_invalid",
            repairApplied: true,
            selectedEvidenceIds: ["evidence-1", "evidence-planned-but-unused"]
          },
          interpretationPlan: {
            discourseMoves: ["核心结论", "关键推导", "领域位置", "成立边界"],
            explanationDepth: "overview",
            externalKnowledgeNeeded: false,
            intent: "mixed",
            intentSignals: ["root_orientation:experimental"],
            intentWeights: { how: 0.25, what: 0.4, why: 0.35 },
            learningGoals: ["core_idea", "paper_panorama", "field_position"],
            paperTypeHint: "experimental",
            readingMode: "orientation",
            retentionFocus: ["核心结论", "关键推导", "领域位置"],
            requestedDepth: "standard"
          },
          model: { id: "deepseek-v4-flash", provider: "deepseek" },
          paperEvidenceRecovery: {
            addedEvidenceIds: ["evidence-recovery-unused"],
            answerObligations: ["补齐论文结论的成立边界"],
            finalAnswerability: "partial",
            initialEvidenceIds: ["evidence-1"],
            status: "exhausted"
          },
          qualityGate: {
            attempts: 3,
            repaired: true,
            repairReasons: ["首次总述重点分散。", "第二次句级映射仍需修复。"]
          },
          evidenceToolCalls: [{
            evidenceIds: ["evidence-1", "evidence-planned-but-unused"],
            kind: "read"
          }],
          version: "liteasy.thin-reading-agent/v2"
        },
        paperEvidence: ["evidence-1"],
        summarySentences: [{
          evidenceIds: ["evidence-1"],
          externalKnowledge: [],
          id: sentenceId,
          status: "grounded",
          text: "论文给出核心结论并说明其成立边界。"
        }]
      },
      omittedSections: [],
      recommendations: [],
      summary: "论文给出核心结论并说明其成立边界。",
      withinPaperClosure: true
    },
    targetLanguage: "zh-CN"
  });

  const reloaded = parseThinReadingDocument(document);
  const audit = reloaded.nodes[reloaded.rootNodeId].evidence.generationAudit;
  expect(audit?.qualityGate.attempts).toBe(3);
  expect(audit?.evidencePlanning).toMatchObject({
    mode: "deterministic_fallback",
    reason: "format_invalid",
    repairApplied: true,
    selectedEvidenceIds: ["evidence-1", "evidence-planned-but-unused"]
  });
  expect(audit?.interpretationPlan?.intentWeights).toEqual({ how: 0.25, what: 0.4, why: 0.35 });
  expect(audit?.evidenceReview?.contentQuality?.logicChain).toBe("complete");
  expect(audit?.evidenceReview?.rootOrientation?.conclusionSupport.status).toBe("complete");
  expect(audit?.paperEvidenceRecovery).toMatchObject({
    addedEvidenceIds: ["evidence-recovery-unused"],
    status: "exhausted"
  });
  expect(audit?.evidenceToolCalls?.[0].evidenceIds).toEqual([
    "evidence-1",
    "evidence-planned-but-unused"
  ]);
});

test("rejects a persisted root conclusion-support chain that references a missing sentence", () => {
  const document = createThinReadingDocument({
    artifactId: "thin-invalid-root-chain",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: {
        externalKnowledge: [],
        generationAudit: {
          evidenceReview: {
            propositionVerdicts: [{
              proposition: "核心结论由边界条件支持",
              sentenceId: "sentence-root-chain",
              verdict: "supported"
            }],
            reason: "正文句由限定证据支持。",
            rootOrientation: {
              conclusionSupport: {
                chains: [{
                  conclusionSentenceId: "sentence-root-chain",
                  reason: "边界条件直接限定核心结论的成立范围。",
                  supportKinds: ["boundary"],
                  supportSentenceIds: ["sentence-does-not-exist"],
                  verdict: "complete"
                }],
                reason: "核心结论具有边界条件支持。",
                status: "complete"
              },
              coreIdea: "covered",
              fieldPosition: "evidence_unavailable",
              paperPanorama: "covered",
              paperType: "experimental",
              paperTypeVerdict: "supported",
              reason: "总述围绕核心结论及边界条件组织。",
              retentionVerdict: "focused",
              verdict: "pass"
            },
            unsupportedSentenceIds: [],
            verdict: "pass"
          },
          model: { id: "test-model", provider: "test" },
          qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
          version: "liteasy.thin-reading-agent/v2"
        },
        paperEvidence: ["evidence-1"],
        summarySentences: [{
          evidenceIds: ["evidence-1"],
          externalKnowledge: [],
          id: "sentence-root-chain",
          status: "grounded",
          text: "核心结论由明确的边界条件支持。"
        }]
      },
      omittedSections: [],
      recommendations: [],
      summary: "核心结论由明确的边界条件支持。",
      withinPaperClosure: true
    },
    targetLanguage: "zh-CN"
  });

  expect(() => parseThinReadingDocument(document)).toThrow("thin_reading_document_invalid");
});

test("reloads a semantic partial boundary and rejects transition or closure drift", () => {
  const document = createMixedBoundaryDocument();
  const root = document.nodes[document.rootNodeId];
  const reloaded = parseThinReadingDocument(document);

  expect(reloaded.nodes[reloaded.rootNodeId]).toMatchObject({
    closureState: "near_boundary",
    supportMode: "paper_and_external",
    withinPaperClosure: false
  });
  expect(
    reloaded.nodes[reloaded.rootNodeId].evidence.generationAudit?.paperAnswerabilityTransition
  ).toMatchObject({ status: "partial", targetSupportMode: "paper_and_external" });
  expect(
    reloaded.nodes[reloaded.rootNodeId].evidence.generationAudit?.evidenceReview
      ?.paperAnswerability?.answerObligations
  ).toEqual([{
    obligation: "解释目标论文中的机制",
    paperCoverage: "complete",
    paperEvidenceIds: ["evidence-1"],
    reason: "目标论文证据完整覆盖机制义务。"
  }, {
    obligation: "解释论文未研究的部署约束",
    paperCoverage: "none",
    paperEvidenceIds: [],
    reason: "该必要义务需要论文外来源。"
  }]);

  expect(() => parseThinReadingDocument({
    ...document,
    nodes: {
      ...document.nodes,
      [document.rootNodeId]: {
        ...root,
        evidence: {
          ...root.evidence,
          generationAudit: {
            ...root.evidence.generationAudit!,
            evidenceReview: {
              ...root.evidence.generationAudit!.evidenceReview!,
              paperAnswerability: {
                ...root.evidence.generationAudit!.evidenceReview!.paperAnswerability!,
                answerObligations: [{
                  obligation: "解释目标论文中的机制",
                  paperCoverage: "complete",
                  paperEvidenceIds: ["evidence-1"],
                  reason: "目标论文证据完整覆盖机制义务。"
                }]
              }
            }
          }
        }
      }
    }
  })).toThrow("thin_reading_document_invalid");

  expect(() => parseThinReadingDocument({
    ...document,
    nodes: {
      ...document.nodes,
      [document.rootNodeId]: {
        ...root,
        evidence: {
          ...root.evidence,
          generationAudit: {
            ...root.evidence.generationAudit!,
            paperAnswerabilityTransition: {
              reason: "错误地把混合来源节点记为纯外部来源。",
              status: "none",
              targetSupportMode: "external_only"
            }
          }
        }
      }
    }
  })).toThrow("thin_reading_document_invalid");

  expect(() => parseThinReadingDocument({
    ...document,
    nodes: {
      ...document.nodes,
      [document.rootNodeId]: { ...root, closureState: "outside_paper" }
    }
  })).toThrow("thin_reading_document_invalid");
});

test("parses v2 nodes with typed visualization requests while retaining v1 command compatibility", () => {
  const document = createThinReadingDocument({
    artifactId: "thin-typed-request",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
      omittedSections: [],
      recommendations: [],
      summary: "A safe new document.",
      withinPaperClosure: true
    },
    targetLanguage: "en-US"
  });
  const next = advanceThinReadingDocument(document, {
    parentNodeId: document.rootNodeId,
    seed: {
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
      omittedSections: [],
      recommendations: [],
      summary: "The request asks for a typed structure visualization.",
      withinPaperClosure: true
    },
    source: {
      excerpt: "A typed structure request.",
      kind: "selected_text",
      quickCommand: "visualize_structure",
      requestedOutput: "visualization_intent"
    },
    title: "Structure"
  });

  expect(parseThinReadingDocument(next).version).toBe("liteasy.thin-reading/v2");
});

test("reuses the persisted annotation bounds for v1 parsing", () => {
  const publicAnnotation = {
    ...v1Fixture.annotations[0],
    id: "annotation-public",
    visibility: "pending_public" as const
  };

  expect(parseThinReadingDocument({
    ...v1Fixture,
    annotations: [publicAnnotation],
    pendingPublicAnnotationIds: [publicAnnotation.id]
  }).version).toBe("liteasy.thin-reading/v1");

  expect(() => parseThinReadingDocument({
    ...v1Fixture,
    pendingPublicAnnotationIds: [v1Fixture.annotations[0].id]
  })).toThrow("thin_reading_document_invalid");
});

test("rejects malformed persisted node bounds for both document versions", () => {
  expect(() => parseThinReadingDocument({
    ...v1Fixture,
    nodes: {
      ...v1Fixture.nodes,
      [v1Fixture.rootNodeId]: { ...v1Fixture.nodes[v1Fixture.rootNodeId], childIds: ["missing"] }
    }
  })).toThrow("thin_reading_document_invalid");

  const v2 = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-invalid", createdAt: now });
  expect(() => parseThinReadingDocument({
    ...v2,
    nodes: {
      ...v2.nodes,
      [v2.rootNodeId]: { ...v2.nodes[v2.rootNodeId], evidence: { ...v2.nodes[v2.rootNodeId].evidence, paperEvidence: ["duplicate", "duplicate"] } }
    }
  })).toThrow("thin_reading_document_invalid");
});

test("rejects an empty persisted artifact identity", () => {
  expect(() => parseThinReadingDocument({
    ...v1Fixture,
    annotations: v1Fixture.annotations.map((annotation) => ({ ...annotation, artifactId: "" })),
    artifactId: ""
  }))
    .toThrow("thin_reading_document_invalid");
});
