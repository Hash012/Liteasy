import { z } from "zod";
import {
  parseVisualizationDecisionOutput,
  visualizationDecisionOutputSchema
} from "./visualizationDecisionPlanner";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const decisionSchema = z.enum(["generate", "omit"]);

const recordSchema = z.object({
  caseId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  input: z.object({
    evidence: z.array(z.object({
      id: z.string().min(1).max(120),
      page: z.number().int().positive(),
      quote: z.string().min(8).max(8_000)
    }).strict()).min(1).max(12),
    question: z.string().min(8).max(1_000),
    targetLanguage: z.enum(["en-US", "zh-CN"]),
    title: z.string().min(3).max(300)
  }).strict(),
  providerRecording: z.object({
    attempts: z.array(z.object({
      accepted: z.boolean(),
      promptSha256: sha256Schema,
      rejectionReason: z.string().min(1).max(2_000).optional(),
      responseSha256: sha256Schema
    }).strict()).min(1).max(3),
    endpoint: z.string().url().refine((value) => value.startsWith("https://")),
    model: z.string().min(1).max(160),
    plannerContract: z.literal("liteasy.visualization-decision-planner/v1"),
    promptSha256: sha256Schema,
    providerId: z.string().min(1).max(160),
    recordedAt: z.string().datetime(),
    response: z.object({
      output: visualizationDecisionOutputSchema,
      sha256: sha256Schema
    }).strict(),
    routeId: z.string().min(1).max(120),
    schemaSha256: sha256Schema
  }).strict(),
  review: z.object({
    decision: decisionSchema,
    rationale: z.string().min(12).max(2_000),
    reviewedAt: z.string().datetime(),
    reviewerId: z.string().min(3).max(160),
    reviewerRole: z.literal("domain_expert")
  }).strict().nullable()
}).strict();

const datasetSchema = z.object({
  protocolVersion: z.literal(2),
  records: z.array(recordSchema).min(1),
  schema: z.literal("liteasy.multimodal-decision-evaluation/v2")
}).strict();

export type MultimodalDecisionEvaluationDataset = z.infer<typeof datasetSchema>;
export type MultimodalDecisionEvaluationRecord = z.infer<typeof recordSchema>;

export function parseMultimodalDecisionEvaluationDataset(input: unknown): MultimodalDecisionEvaluationDataset {
  const dataset = datasetSchema.parse(input);
  if (new Set(dataset.records.map(({ caseId }) => caseId)).size !== dataset.records.length) {
    throw new Error("multimodal_decision_case_duplicate");
  }
  for (const record of dataset.records) {
    parseVisualizationDecisionOutput(record.providerRecording.response.output, {
      allowedEvidenceIds: record.input.evidence.map(({ id }) => id)
    });
    const attempts = record.providerRecording.attempts;
    const finalAttempt = attempts[attempts.length - 1];
    if (attempts[0]?.promptSha256 !== record.providerRecording.promptSha256 ||
      attempts.slice(0, -1).some(({ accepted, rejectionReason }) => accepted || !rejectionReason) ||
      finalAttempt?.accepted !== true || finalAttempt.rejectionReason !== undefined ||
      finalAttempt?.responseSha256 !== record.providerRecording.response.sha256) {
      throw new Error("multimodal_decision_attempt_trace_invalid");
    }
  }
  return dataset;
}

export function evaluateGenerationDecisions(records: readonly MultimodalDecisionEvaluationRecord[]) {
  const reviewed = records.filter((record) => record.review !== null);
  const necessary = reviewed.filter((record) => record.review?.decision === "generate");
  const unnecessary = reviewed.filter((record) => record.review?.decision === "omit");
  const observed = (record: MultimodalDecisionEvaluationRecord) => record.providerRecording.response.output.decision;
  const generatedNecessary = necessary.filter((record) => observed(record) === "generate").length;
  const generatedUnnecessary = unnecessary.filter((record) => observed(record) === "generate").length;
  const pendingExpertReviews = records.length - reviewed.length;
  const hasBothLabelClasses = necessary.length > 0 && unnecessary.length > 0;
  const qualityGateEligible = records.length > 0 && pendingExpertReviews === 0 && hasBothLabelClasses;
  const decisionAccuracy = qualityGateEligible
    ? reviewed.filter((record) => observed(record) === record.review?.decision).length / reviewed.length
    : null;
  const necessaryGenerationRecall = qualityGateEligible ? generatedNecessary / necessary.length : null;
  const unnecessaryGenerationRate = qualityGateEligible ? generatedUnnecessary / unnecessary.length : null;
  const qualityGatePassed = qualityGateEligible &&
    decisionAccuracy! >= 0.9 &&
    necessaryGenerationRecall! >= 0.85 &&
    unnecessaryGenerationRate! <= 0.05;

  return {
    decisionAccuracy,
    necessaryGenerationRecall,
    pendingExpertReviews,
    qualityGateEligible,
    qualityGatePassed,
    reviewedRecords: reviewed.length,
    totalRecords: records.length,
    unnecessaryGenerationRate
  };
}
