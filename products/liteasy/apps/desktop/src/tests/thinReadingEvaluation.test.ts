import { describe, expect, test } from "vitest";
import {
  evaluateThinReadingGoldCase,
  evaluateThinReadingSuite
} from "../app/features/thin-reading/thinReadingEvaluation";
import { thinReadingGoldFixtures } from "./fixtures/thinReadingGoldFixtures";

describe("thinReadingEvaluation", () => {
  test("passes the curated multi-type reference suite", () => {
    const report = evaluateThinReadingSuite(thinReadingGoldFixtures);

    expect(new Set(thinReadingGoldFixtures.map(({ gold }) => gold.paperType))).toEqual(new Set([
      "dataset",
      "experimental",
      "humanities",
      "survey",
      "systems",
      "theoretical"
    ]));
    expect(new Set(thinReadingGoldFixtures.map(({ gold }) => gold.stage))).toEqual(new Set([
      "branch",
      "root"
    ]));
    expect(report.passed).toBe(true);
    expect(report.failedGoldIds).toEqual([]);
    expect(report.averageScore).toBeGreaterThanOrEqual(0.9);
  });

  test("allows an explicitly curated paper-type ambiguity without weakening default type checks", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const ambiguousGold = {
      ...fixture.gold,
      acceptablePaperTypes: ["experimental", "systems"] as const
    };
    const systemsCandidate = {
      ...fixture.candidate,
      paperType: "systems" as const
    };

    expect(evaluateThinReadingGoldCase({
      candidate: systemsCandidate,
      gold: fixture.gold
    }).metrics.paperTypeAccuracy.score).toBe(0);
    expect(evaluateThinReadingGoldCase({
      candidate: systemsCandidate,
      gold: ambiguousGold
    }).metrics.paperTypeAccuracy.score).toBe(1);
  });

  test("requires curated Chinese terminology to retain both the original term and its meaning", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const gold = {
      ...fixture.gold,
      requiredTerminology: [{ original: "late interaction", translation: "后期交互" }]
    };
    const retained = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        summary: "ColBERT 以 late interaction（后期交互）保留 token-level matching（词元级匹配），并提升检索效果。"
      },
      gold
    });
    const dropped = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        summary: "ColBERT 以后期交互保留词元级匹配，并提升检索效果。"
      },
      gold
    });
    const separated = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        summary: "ColBERT 使用 late interaction 来检索。后期交互保留了词元级匹配。"
      },
      gold
    });

    expect(retained.metrics.terminologyRetention.score).toBe(1);
    expect(dropped.metrics.terminologyRetention.score).toBe(0);
    expect(separated.metrics.terminologyRetention.score).toBe(0);
    expect(dropped.issues).toContainEqual(expect.objectContaining({
      code: "terminology_retention_below_threshold"
    }));
  });

  test("reports semantic, citation, language, and sentence-boundary regressions together", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const candidate = {
      ...fixture.candidate,
      evidence: {
        ...fixture.candidate.evidence,
        claims: [{
          evidenceIds: ["evidence-unrelated"],
          id: "claim-regressed",
          status: "unsupported" as const,
          text: "A generic introduction without a retained result."
        }],
        paperEvidence: ["evidence-unrelated"],
        paperEvidenceSpans: [],
        summarySentences: [{
          evidenceIds: ["evidence-unrelated"],
          externalKnowledge: [],
          id: "sentence-regressed",
          status: "grounded" as const,
          text: "A generic introduction without a retained result."
        }]
      },
      omittedSections: [],
      paperType: "survey" as const,
      summary: "A generic introduction without a retained result."
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });
    const issueCodes = report.issues.map((issue) => issue.code);

    expect(report.passed).toBe(false);
    expect(issueCodes).toEqual(expect.arrayContaining([
      "citation_precision_below_threshold",
      "language_inconsistent",
      "omitted_section_recall_below_threshold",
      "paper_type_mismatch",
      "sentence_boundary_incomplete",
      "summary_core_recall_below_threshold",
      "unsupported_claim_ratio_above_threshold"
    ]));
  });

  test("fails a root overview that keeps the core idea but loses its field position", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-theoretical-convergence"
    )!;
    const candidate = {
      ...fixture.candidate,
      summary: "The paper proves a tighter convergence bound under a smoothness assumption; its proof route couples a stability lemma with a telescoping argument."
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });

    expect(report.metrics.summaryCoreRecall.score).toBe(1);
    expect(report.metrics.rootOrientationCoverage.score).toBeLessThan(1);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "root_orientation_incomplete"
    }));
  });

  test("rejects sentence evidence mappings that do not cover the displayed summary", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const candidate = {
      ...fixture.candidate,
      evidence: {
        ...fixture.candidate.evidence,
        summarySentences: [{
          evidenceIds: fixture.candidate.evidence.paperEvidence,
          externalKnowledge: [],
          id: "sentence-drifted-away-from-summary",
          status: "grounded" as const,
          text: "This unrelated sentence has a valid evidence identifier."
        }]
      }
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });

    expect(report.metrics.sentenceBoundaryCoverage.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "sentence_boundary_incomplete"
    }));
  });

  test("rejects a sentence trace that leaves even a short displayed suffix unmapped", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const candidate = {
      ...fixture.candidate,
      summary: `${fixture.candidate.summary} x`
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });

    expect(report.metrics.sentenceBoundaryCoverage.score).toBeLessThan(1);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "sentence_boundary_incomplete"
    }));
  });

  test("accepts an ordered sentence trace when only punctuation separators are omitted", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-experimental-colbert"
    )!;
    const evidenceId = fixture.candidate.evidence.paperEvidence[0];
    const candidate = {
      ...fixture.candidate,
      summary: "第一句保留 MaxSim。第二句说明 token-level matching。",
      evidence: {
        ...fixture.candidate.evidence,
        claims: [{
          evidenceIds: [evidenceId],
          id: "punctuation-boundary-claim",
          status: "grounded" as const,
          text: "MaxSim 保留 token-level matching。"
        }],
        summarySentences: [
          {
            evidenceIds: [evidenceId],
            externalKnowledge: [],
            id: "punctuation-boundary-first",
            status: "grounded" as const,
            text: "第一句保留 MaxSim"
          },
          {
            evidenceIds: [evidenceId],
            externalKnowledge: [],
            id: "punctuation-boundary-second",
            status: "grounded" as const,
            text: "第二句说明 token-level matching"
          }
        ]
      }
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });

    expect(report.metrics.sentenceBoundaryCoverage.score).toBe(1);
  });

  test("does not award citation precision when required gold evidence is not cited", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-systems-acorn"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          claims: [],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: []
        }
      },
      gold: fixture.gold
    });

    expect(report.metrics.citationPrecision.score).toBe(0);
    expect(report.metrics.unsupportedClaimRatio.score).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "citation_precision_below_threshold"
    }));
  });

  test("rejects a partial citation set when a second gold evidence span is required", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-systems-acorn"
    )!;
    const firstEvidenceId = fixture.candidate.evidence.paperEvidence[0];
    const firstSpan = fixture.candidate.evidence.paperEvidenceSpans?.find((span) => span.id === firstEvidenceId)!;
    const secondEvidenceId = "evidence-acorn-second-required";
    const gold = {
      ...fixture.gold,
      relevantEvidenceIds: [firstEvidenceId, secondEvidenceId],
      requiredEvidence: [
        { evidenceId: firstEvidenceId, page: firstSpan.page!, quote: firstSpan.quote },
        { evidenceId: secondEvidenceId, page: 2, quote: "A second required experimental observation." }
      ]
    };

    const report = evaluateThinReadingGoldCase({ candidate: fixture.candidate, gold });

    expect(report.metrics.citationPrecision.score).toBe(1);
    expect(report.metrics.citationRecall.score).toBe(0.5);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "citation_recall_below_threshold"
    }));
  });

  test("fails a fluent branch that drops both the selected target and parent continuity", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-maxsim"
    )!;
    const candidate = {
      ...fixture.candidate,
      evidence: {
        ...fixture.candidate.evidence,
        claims: fixture.candidate.evidence.claims?.map((claim) => ({
          ...claim,
          text: "实验部分还包含若干常规结果，值得继续阅读。"
        }))
      },
      summary: "实验部分还包含若干常规结果，值得继续阅读。"
    };

    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });

    expect(report.passed).toBe(false);
    expect(report.metrics.branchRelevance.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "branch_relevance_below_threshold"
    }));
  });

  test("requires an explicit external boundary when external sources enter the node", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: { ...fixture.candidate, withinPaperClosure: true },
      gold: fixture.gold
    });

    expect(report.passed).toBe(false);
    expect(report.metrics.closureBoundaryAccuracy.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "closure_boundary_mismatch"
    }));
  });

  test("rejects external knowledge whose source ID cannot be traced to a provider record", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          externalSources: []
        }
      },
      gold: fixture.gold
    });

    expect(report.passed).toBe(false);
    expect(report.metrics.externalSourceTraceability.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "external_source_untraceable"
    }));
  });

  test("accepts a canonical Crossref topic source without treating it as a citation graph", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const crossrefId = "crossref:10.1038/s41586-021-03819-2";
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          externalKnowledge: [crossrefId],
          externalSources: [{
            abstract: "A paper record supplied by Crossref.",
            authors: ["J. Jumper"],
            doi: "https://doi.org/10.1038/s41586-021-03819-2",
            id: crossrefId,
            provider: "crossref",
            relation: "topic_search",
            relevance: 0.8,
            retrievalQuery: "protein structure prediction",
            sourceId: "10.1038/s41586-021-03819-2",
            sourceRecordUrl: "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2",
            title: "Highly accurate protein structure prediction with AlphaFold",
            url: "https://doi.org/10.1038/s41586-021-03819-2"
          }],
          summarySentences: fixture.candidate.evidence.summarySentences?.map((sentence) => ({
            ...sentence,
            externalKnowledge: [crossrefId]
          }))
        }
      },
      gold: fixture.gold
    });

    expect(report.metrics.externalSourceTraceability.score).toBe(1);
    expect(report.metrics.externalRelationFidelity.score).toBe(1);
  });

  test("rejects an external source with an invented relationship label", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          externalSources: fixture.candidate.evidence.externalSources?.map((source) => ({
            ...source,
            relation: "invented_relation" as never
          }))
        }
      },
      gold: fixture.gold
    });

    expect(report.metrics.externalSourceTraceability.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "external_source_untraceable"
    }));
  });

  test("keeps a verified cited-by relationship outside the target paper's evidence closure", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-bert-cited-by-alphafold"
    )!;
    const report = evaluateThinReadingGoldCase(fixture);

    expect(report.passed).toBe(true);
    expect(fixture.candidate.evidence.externalSources).toEqual([
      expect.objectContaining({
        id: "openalex:W3177828909",
        relation: "cites_target",
        sourceId: "W3177828909"
      })
    ]);
  });

  test("rejects a traceable but wrong external source identity or relation", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-bert-cited-by-alphafold"
    )!;
    const wrongIdentity = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          externalKnowledge: ["openalex:W43"],
          externalSources: [{
            ...(fixture.candidate.evidence.externalSources ?? [])[0],
            id: "openalex:W43",
            sourceId: "W43",
            sourceRecordUrl: "https://openalex.org/W43"
          }],
          summarySentences: fixture.candidate.evidence.summarySentences?.map((sentence) => ({
            ...sentence,
            externalKnowledge: ["openalex:W43"]
          }))
        }
      },
      gold: fixture.gold
    });
    const wrongRelation = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          externalSources: fixture.candidate.evidence.externalSources?.map((source) => ({
            ...source,
            relation: "related" as const
          }))
        }
      },
      gold: fixture.gold
    });

    expect(wrongIdentity.metrics.externalSourceTraceability.score).toBe(1);
    expect(wrongIdentity.metrics.externalSourceGoldMatch.score).toBe(0);
    expect(wrongIdentity.issues).toContainEqual(expect.objectContaining({
      code: "external_source_mismatch"
    }));
    expect(wrongRelation.metrics.externalSourceGoldMatch.score).toBe(0);
    expect(wrongRelation.issues).toContainEqual(expect.objectContaining({
      code: "external_source_mismatch"
    }));
  });

  test("rejects a topic-search source when the summary upgrades it into a citation relationship", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const falseCitationSummary = "OpenAlex 显示该主题检索结果引用了目标论文。";
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          claims: fixture.candidate.evidence.claims?.map((claim) => ({ ...claim, text: falseCitationSummary })),
          summarySentences: fixture.candidate.evidence.summarySentences?.map((sentence) => ({
            ...sentence,
            text: falseCitationSummary
          }))
        },
        summary: falseCitationSummary
      },
      gold: fixture.gold
    });

    expect(report.metrics.externalRelationFidelity.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "external_relation_misrepresented"
    }));
  });

  test("keeps relation fidelity strict when topic-search and citation-graph sources are mixed", () => {
    const fixture = thinReadingGoldFixtures.find(({ gold }) =>
      gold.id === "gold-branch-external-boundary"
    )!;
    const report = evaluateThinReadingGoldCase({
      candidate: {
        ...fixture.candidate,
        evidence: {
          ...fixture.candidate.evidence,
          externalKnowledge: ["openalex:W2741809807", "openalex:W43"],
          externalSources: [
            ...(fixture.candidate.evidence.externalSources ?? []),
            {
              abstract: "A verified graph neighbor.", authors: [], id: "openalex:W43", provider: "openalex",
              relation: "cites_target", relevance: 0.7, retrievalQuery: "open access research",
              sourceRecordUrl: "https://openalex.org/W43", sourceId: "W43", title: "Graph neighbor", url: "https://doi.org/10.1000/graph"
            }
          ],
          summarySentences: [{
            ...(fixture.candidate.evidence.summarySentences ?? [])[0],
            externalKnowledge: ["openalex:W2741809807"],
            text: "This topic-search result cites the target paper."
          }]
        },
        summary: "This topic-search result cites the target paper."
      },
      gold: fixture.gold
    });

    expect(report.metrics.externalRelationFidelity.score).toBe(0);
  });
});
