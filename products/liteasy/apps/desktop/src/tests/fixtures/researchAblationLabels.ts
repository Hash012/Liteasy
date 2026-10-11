import { z } from "zod";

/** Evaluation-only annotations. These are never consumed by production UI or verifiers. */
export const researchAblationLabelsSchema = z.object({
  origin: z.literal("independent_human"), annotator: z.string(), sourceSha256: z.string(), question: z.string(),
  keyEvidenceIds: z.array(z.string()),
  strategies: z.array(z.object({
    strategy: z.string(), answer: z.string(), recoveredEvidenceIds: z.array(z.string()),
    claims: z.array(z.object({ text: z.string(), support: z.enum(["supported", "unsupported", "uncertain", "not_factual"]) }))
  }))
});
export type ResearchAblationLabels = z.infer<typeof researchAblationLabelsSchema>;

export function researchAblationQuality(input: {
  sourceSha256: string;
  question: string;
  strategy: string;
  evidenceIds: string[];
  answer?: string;
  labels?: ResearchAblationLabels;
}) {
  const missing = { keyEvidenceRecall: null, unsupportedClaimRate: null, annotationStatus: "not_measured" } as const;
  const labels = input.labels;
  if (!labels || labels.origin !== "independent_human" || !labels.annotator.trim() || labels.sourceSha256 !== input.sourceSha256 || labels.question !== input.question) return missing;
  const row = labels.strategies.find((item) => item.strategy === input.strategy);
  const keys = [...new Set(labels.keyEvidenceIds)];
  if (!row || row.answer !== input.answer || !keys.length || keys.some((id) => !input.evidenceIds.includes(id)) || row.recoveredEvidenceIds.some((id) => !input.evidenceIds.includes(id))) return missing;
  const factual = row.claims.filter((claim) => claim.support !== "not_factual");
  // Unresolved human labels must not become a conveniently low unsupported rate.
  if (!factual.length || factual.some((claim) => !claim.text.trim() || claim.support === "uncertain")) return missing;
  return {
    keyEvidenceRecall: keys.filter((id) => row.recoveredEvidenceIds.includes(id)).length / keys.length,
    unsupportedClaimRate: factual.filter((claim) => claim.support === "unsupported").length / factual.length,
    annotationStatus: "independent_human_labels"
  };
}
