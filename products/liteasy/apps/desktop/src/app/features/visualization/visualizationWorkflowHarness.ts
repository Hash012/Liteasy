import type { BuiltinSkillLoader, BuiltinSkillPackageV1 } from "../skills/builtinSkill.types";
import { loadBuiltinSkill } from "../skills/builtinSkillRegistry";
import { createArtifactWorkflowHarness, type ArtifactWorkflowTrace } from "../artifact-workflow/artifactWorkflowHarness";
import { parseVisualizationArtifact } from "./visualizationArtifact.schema";
import type { ValidationReportV1, VisualizationArtifactV1, VisualizationModality } from "./visualizationArtifact.types";
import { runVisualizationValidators } from "./visualizationValidator";
import { getVisualizationValidators } from "./visualizationValidatorRegistry";

export type VisualizationWorkflowTraceKind = "draft" | "verification" | "repair" | "fallback" | "publish";

export type VisualizationWorkflowInput = {
  artifactId: string;
  runId: string;
  skill?: BuiltinSkillPackageV1;
  skillId?: string;
  loadSkill?: BuiltinSkillLoader;
  skillLoader?: BuiltinSkillLoader;
  signal?: AbortSignal;
  generate?: (signal?: AbortSignal) => Promise<unknown>;
  generateDraft?: (signal?: AbortSignal) => Promise<unknown>;
  repair: (draft: VisualizationArtifactV1, report: ValidationReportV1, signal?: AbortSignal) => Promise<unknown>;
  fallback?: (modality: VisualizationModality, draft: VisualizationArtifactV1, signal?: AbortSignal) => Promise<unknown>;
  createFallback?: (modality: VisualizationModality, draft: VisualizationArtifactV1, signal?: AbortSignal) => Promise<unknown>;
  now?: () => Date;
};

export type VisualizationWorkflowResult =
  | { status: "verified"; artifact: VisualizationArtifactV1; validation: ValidationReportV1; trace: VisualizationWorkflowTrace }
  | { status: "degraded"; artifact: VisualizationArtifactV1; validation: ValidationReportV1; trace: VisualizationWorkflowTrace }
  | { status: "omitted"; report: ValidationReportV1; trace: VisualizationWorkflowTrace };

type VisualizationWorkflowTrace = ArtifactWorkflowTrace<VisualizationWorkflowTraceKind, "liteasy.visualization-workflow-trace/v1">;

function cancelled(): Error {
  return new Error("visualization_cancelled");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function validationContext(artifact: VisualizationArtifactV1, repairCount: 0 | 1) {
  return {
    accessibility: artifact.accessibility,
    artifactVersion: artifact.artifactVersion,
    evidenceBindings: artifact.evidenceBindings,
    interaction: artifact.interaction,
    modality: artifact.modality,
    repairCount,
    semanticObjects: artifact.semanticObjects,
    spec: artifact.spec
  };
}

function withValidation(value: unknown, report: ValidationReportV1): VisualizationArtifactV1 {
  if (!value || typeof value !== "object") throw new Error("visualization_artifact_invalid");
  return { ...(value as VisualizationArtifactV1), validation: report };
}

function schemaFailure(repairCount: 0 | 1): ValidationReportV1 {
  return {
    checks: [{ diagnosticCode: "visualization_artifact_invalid", gate: "hard", outcome: "fail", validatorId: "artifact-schema", validatorVersion: "1.0.0" }],
    outcome: "fail",
    repairCount
  };
}

export async function runVisualizationWorkflow(input: VisualizationWorkflowInput): Promise<VisualizationWorkflowResult> {
  const signal = input.signal;
  const now = input.now ?? (() => new Date());
  const harness = createArtifactWorkflowHarness<VisualizationWorkflowTraceKind, "liteasy.visualization-workflow-trace/v1">({
    artifactId: input.artifactId,
    now,
    runId: input.runId,
    tracePrefix: "visualization-workflow",
    traceVersion: "liteasy.visualization-workflow-trace/v1"
  });

  try {
    assertNotAborted(signal);
    const skill = input.skill ?? await (input.loadSkill ?? input.skillLoader ?? (() => loadBuiltinSkill(input.skillId ?? "source-figure")))();
    const validators = getVisualizationValidators(skill.manifest.validatorIds);
    const generate = input.generate ?? input.generateDraft;
    const fallback = input.fallback ?? input.createFallback;
    if (!generate || !fallback) throw new Error("visualization_workflow_callback_missing");

    const first = await harness.step({
      kind: "draft",
      run: () => generate(signal),
      signal,
      summary: "构造可视化草稿"
    });
    let current = first as VisualizationArtifactV1;

    const validate = async (artifact: VisualizationArtifactV1, repairCount: 0 | 1): Promise<{ report: ValidationReportV1; schemaValid: boolean }> => {
      try {
        parseVisualizationArtifact({
          ...artifact,
          validation: {
            checks: [{ gate: "hard", outcome: "pass", validatorId: "artifact-schema", validatorVersion: "1.0.0" }],
            outcome: "pass",
            repairCount
          }
        });
      } catch {
        return { report: schemaFailure(repairCount), schemaValid: false };
      }
      return { report: await runVisualizationValidators(validationContext(artifact, repairCount), validators), schemaValid: true };
    };
    const verify = async (artifact: VisualizationArtifactV1, repairCount: 0 | 1) => {
      const result = await harness.step({
        details: { repairCount },
        kind: "verification",
        run: () => validate(artifact, repairCount),
        signal,
        summary: "确定性校验"
      });
      const steps = harness.trace().steps;
      const step = steps[steps.length - 1];
      if (result.report.outcome !== "pass" && step) {
        step.status = "blocked";
        step.summary = "确定性校验未通过";
      }
      return result;
    };

    let verification = await verify(current, 0);
    let report = verification.report;
    if (!verification.schemaValid) return { report, status: "omitted", trace: harness.trace() };
    if (report.outcome === "pass") {
      const artifact = await harness.step({
        kind: "publish",
        run: () => parseVisualizationArtifact(withValidation(current, report)),
        signal,
        summary: "发布已验证产物"
      });
      return { artifact, status: "verified", trace: harness.trace(), validation: report };
    }

    const repaired = await harness.step({
      details: { repairCount: 1 },
      kind: "repair",
      run: () => input.repair(current, report, signal),
      signal,
      summary: "尝试一次安全修复"
    });
    current = repaired as VisualizationArtifactV1;
    verification = await verify(current, 1);
    report = verification.report;
    if (!verification.schemaValid) return { report, status: "omitted", trace: harness.trace() };
    if (report.outcome === "pass") {
      const artifact = await harness.step({
        kind: "publish",
        run: () => parseVisualizationArtifact(withValidation(current, report)),
        signal,
        summary: "发布已验证产物"
      });
      return { artifact, status: "verified", trace: harness.trace(), validation: report };
    }

    for (const modality of skill.manifest.fallbackModalities) {
      const fallbackDraft = await harness.step({
        details: { modality },
        kind: "fallback",
        run: () => fallback(modality, current, signal),
        signal,
        summary: "尝试安全降级"
      });
      const fallbackStep = harness.trace().steps[harness.trace().steps.length - 1];
      const candidate = fallbackDraft as VisualizationArtifactV1;
      if (!candidate || candidate.modality !== modality || candidate.spec?.modality !== modality) {
        if (fallbackStep) {
          fallbackStep.status = "blocked";
          fallbackStep.summary = "降级产物模态不匹配";
          fallbackStep.details = {
            ...(fallbackStep.details ?? {}),
            error: "visualization_fallback_modality_mismatch",
            actualModality: candidate?.modality ?? "unknown",
            expectedModality: modality
          };
        }
        continue;
      }
      const fallbackArtifact = {
        ...candidate,
        fallbackHistory: [
          ...(candidate.fallbackHistory ?? []),
          { from: current.modality, reasonCode: "validation_failed_after_repair", to: modality }
        ]
      } as VisualizationArtifactV1;
      const fallbackVerification = await verify(fallbackArtifact, 1);
      const fallbackReport = fallbackVerification.report;
      if (!fallbackVerification.schemaValid) continue;
      if (fallbackReport.outcome !== "pass") continue;
      const artifact = await harness.step({
        kind: "publish",
        run: () => parseVisualizationArtifact(withValidation(fallbackArtifact, fallbackReport)),
        signal,
        summary: "发布已验证降级产物"
      });
      return { artifact, status: "degraded", trace: harness.trace(), validation: fallbackReport };
    }

    assertNotAborted(signal);
    return { report, status: "omitted", trace: harness.trace() };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && (error.message === "artifact_workflow_cancelled" || error.message === "visualization_cancelled"))) {
      throw cancelled();
    }
    throw error;
  }
}
