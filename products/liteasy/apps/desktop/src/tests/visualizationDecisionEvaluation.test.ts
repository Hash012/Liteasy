import { describe, expect, test } from "vitest";
import {
  evaluateGenerationDecisions,
  parseMultimodalDecisionEvaluationDataset,
  type MultimodalDecisionEvaluationRecord
} from "../app/features/visualization/visualizationDecisionEvaluation";

function record(
  caseId: string,
  observed: "generate" | "omit",
  expected: "generate" | "omit" | null
): MultimodalDecisionEvaluationRecord {
  return {
    caseId,
    input: {
      evidence: [{ id: `evidence-${caseId}`, page: 1, quote: "This is bounded scientific evidence for the evaluation case." }],
      question: "Explain this evidence and decide whether a visual materially helps.",
      targetLanguage: "en-US",
      title: `Evaluation case ${caseId}`
    },
    providerRecording: {
      attempts: [{
        accepted: true,
        promptSha256: "a".repeat(64),
        responseSha256: "b".repeat(64)
      }],
      endpoint: "https://provider.example/v1/responses",
      model: "model-1",
      plannerContract: "liteasy.visualization-decision-planner/v1",
      promptSha256: "a".repeat(64),
      providerId: "openai-compatible",
      recordedAt: "2026-08-11T00:00:00.000Z",
      response: {
        output: observed === "omit" ? {
          basis: "plain_text_sufficient",
          decision: "omit",
          evidenceIds: [],
          rationale: "The evidence is already clearer and more precise as concise text."
        } : {
          basis: "semantic_structure",
          decision: "generate",
          evidenceIds: [`evidence-${caseId}`],
          rationale: "The evidence defines multiple components and dependencies that need a structural view."
        },
        sha256: "b".repeat(64)
      },
      routeId: "provider-route",
      schemaSha256: "c".repeat(64)
    },
    review: expected === null ? null : {
      decision: expected,
      rationale: "A domain expert reviewed whether the visual adds material explanatory value.",
      reviewedAt: "2026-08-11T01:00:00.000Z",
      reviewerId: "expert-reviewer",
      reviewerRole: "domain_expert"
    }
  };
}

describe("visualization decision evaluation", () => {
  test("fails closed while any real provider record awaits expert review", () => {
    expect(evaluateGenerationDecisions([
      record("pending-case", "generate", null)
    ])).toEqual({
      decisionAccuracy: null,
      necessaryGenerationRecall: null,
      pendingExpertReviews: 1,
      qualityGateEligible: false,
      qualityGatePassed: false,
      reviewedRecords: 0,
      totalRecords: 1,
      unnecessaryGenerationRate: null
    });
  });

  test("derives metrics from provider output and independent expert labels", () => {
    expect(evaluateGenerationDecisions([
      record("true-positive", "generate", "generate"),
      record("false-negative", "omit", "generate"),
      record("false-positive", "generate", "omit"),
      record("true-negative", "omit", "omit")
    ])).toEqual({
      decisionAccuracy: 0.5,
      necessaryGenerationRecall: 0.5,
      pendingExpertReviews: 0,
      qualityGateEligible: true,
      qualityGatePassed: false,
      reviewedRecords: 4,
      totalRecords: 4,
      unnecessaryGenerationRate: 0.5
    });
  });

  test("passes only when every measured threshold passes", () => {
    expect(evaluateGenerationDecisions([
      record("necessary-one", "generate", "generate"),
      record("necessary-two", "generate", "generate"),
      record("unnecessary-one", "omit", "omit"),
      record("unnecessary-two", "omit", "omit")
    ])).toEqual(expect.objectContaining({
      decisionAccuracy: 1,
      necessaryGenerationRecall: 1,
      qualityGateEligible: true,
      qualityGatePassed: true,
      unnecessaryGenerationRate: 0
    }));
  });

  test("rejects duplicate cases and unverifiable provider metadata", () => {
    const valid = record("duplicate-case", "omit", null);
    expect(() => parseMultimodalDecisionEvaluationDataset({
      protocolVersion: 2,
      records: [valid, valid],
      schema: "liteasy.multimodal-decision-evaluation/v2"
    })).toThrow("multimodal_decision_case_duplicate");
    expect(() => parseMultimodalDecisionEvaluationDataset({
      protocolVersion: 2,
      records: [{
        ...valid,
        providerRecording: { ...valid.providerRecording, promptSha256: "not-a-hash" }
      }],
      schema: "liteasy.multimodal-decision-evaluation/v2"
    })).toThrow();
    expect(() => parseMultimodalDecisionEvaluationDataset({
      protocolVersion: 2,
      records: [{
        ...valid,
        providerRecording: {
          ...valid.providerRecording,
          attempts: [{
            accepted: false,
            promptSha256: "a".repeat(64),
            responseSha256: "b".repeat(64)
          }]
        }
      }],
      schema: "liteasy.multimodal-decision-evaluation/v2"
    })).toThrow("multimodal_decision_attempt_trace_invalid");
  });
});
