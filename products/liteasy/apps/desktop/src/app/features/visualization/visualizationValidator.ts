import type {
  AccessibilityProjectionV1,
  EvidenceBindingV1,
  InteractionContractV1,
  SemanticObjectV1,
  ValidationReportV1,
  VisualizationModality,
  VisualizationSpecV1
} from "./visualizationArtifact.types";

export type VisualizationValidationContext = {
  artifactVersion: string;
  modality: VisualizationModality;
  spec: VisualizationSpecV1;
  evidenceBindings: EvidenceBindingV1[];
  semanticObjects: SemanticObjectV1[];
  interaction: InteractionContractV1;
  accessibility: AccessibilityProjectionV1;
  repairCount: 0 | 1;
  resourceLimits?: {
    maxSemanticObjects?: number;
    maxEvidenceBindings?: number;
    maxPayloadBytes?: number;
  };
};

export type VisualizationValidationCheck = ValidationReportV1["checks"][number];

export type VisualizationValidator = {
  id: string;
  version: string;
  gate: "hard" | "advisory";
  validate: (context: VisualizationValidationContext) => Promise<VisualizationValidationCheck> | VisualizationValidationCheck;
};

export async function runVisualizationValidators(
  context: VisualizationValidationContext,
  validators: readonly VisualizationValidator[]
): Promise<ValidationReportV1> {
  const checks: VisualizationValidationCheck[] = [];
  for (const validator of validators) checks.push(await validator.validate(context));
  const hardFailed = checks.some((check) => check.gate === "hard" && check.outcome !== "pass");
  return { checks, outcome: hardFailed ? "fail" : "pass", repairCount: context.repairCount };
}
