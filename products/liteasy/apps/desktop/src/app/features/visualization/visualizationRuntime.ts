import { z } from "zod";
import { parseVisualizationArtifact } from "./visualizationArtifact.schema";
import type { VisualizationArtifactV1, VisualizationModality } from "./visualizationArtifact.types";
import { getVisualizationKernelRegistration, getVisualizationRendererRegistration } from "./visualizationRendererRegistry";
import type { VisualizationRevalidationWorkerService } from "./visualizationRevalidationWorker";
import { getVisualizationValidator } from "./visualizationValidatorRegistry";

export type VisualizationArtifactStatus = "ready" | "degraded" | "needs_revalidation" | "omitted";

export type VisualizationArtifactIndex = {
  evidenceHash: string;
  hardValidatorVersions: Record<string, string>;
  kernelVersion?: string;
  rendererVersion: string;
  skillVersion: string;
  specHash: string;
};

export type VisualizationSafePreview = {
  imageRef: string;
  kind: "static";
};

export type VisualizationArtifactEnvelope = {
  artifact: VisualizationArtifactV1;
  artifactIndex: VisualizationArtifactIndex;
  safePreview?: VisualizationSafePreview;
  status: "ready" | "degraded";
};

export type VisualizationArtifactLoadOptions = {
  currentValidatorVersions?: Record<string, string>;
  currentKernelVersions?: Record<string, string>;
  documentAccess?: boolean;
  offline?: boolean;
  revalidationService?: VisualizationRevalidationWorkerService;
  revokedRendererIds?: readonly string[];
  revokedValidatorIds?: readonly string[];
  revokedKernelIds?: readonly string[];
  signal?: AbortSignal;
};

export type VisualizationArtifactState = {
  artifact: VisualizationArtifactV1;
  artifactIndex: VisualizationArtifactIndex;
  canGenerate: boolean;
  canRender: boolean;
  canRenderSafePreview: boolean;
  safePreview?: VisualizationSafePreview;
  status: VisualizationArtifactStatus;
};

const artifactIndexSchema = z.object({
  evidenceHash: z.string().min(1),
  hardValidatorVersions: z.record(z.string().min(1), z.string().min(1)).refine((versions) => Object.keys(versions).length > 0, "visualization_hard_validator_set_empty"),
  kernelVersion: z.string().min(1).optional(),
  rendererVersion: z.string().min(1),
  skillVersion: z.string().min(1),
  specHash: z.string().min(1)
}).strict();

const safePreviewSchema = z.object({
  imageRef: z.string().min(1),
  kind: z.literal("static")
}).strict();

const artifactEnvelopeSchema = z.object({
  artifact: z.unknown(),
  artifactIndex: artifactIndexSchema,
  safePreview: safePreviewSchema.optional(),
  status: z.enum(["ready", "degraded"])
}).strict();

export function parseVisualizationArtifactEnvelope(value: unknown): VisualizationArtifactEnvelope {
  const envelope = artifactEnvelopeSchema.safeParse(value);
  if (!envelope.success) throw new Error("visualization_artifact_envelope_invalid");
  try {
    return {
      artifact: parseVisualizationArtifact(envelope.data.artifact),
      artifactIndex: envelope.data.artifactIndex,
      safePreview: envelope.data.safePreview,
      status: envelope.data.status
    };
  } catch {
    throw new Error("visualization_artifact_envelope_invalid");
  }
}

export async function loadVisualizationArtifact(
  value: VisualizationArtifactEnvelope,
  options: VisualizationArtifactLoadOptions = {}
): Promise<VisualizationArtifactState> {
  const envelope = parseVisualizationArtifactEnvelope(value);
  const documentAccess = options.documentAccess ?? true;
  const authoritative = getAuthoritativeValidatorVersions(envelope.artifactIndex);
  const expectedHardValidatorVersions = options.currentValidatorVersions ?? authoritative.versions;
  const expectedValidatorIds = Object.keys(expectedHardValidatorVersions);
  const expectedValidatorSetComplete = expectedValidatorIds.length > 0
    && expectedValidatorIds.every((id) => {
      const validator = getVisualizationValidator(id);
      return validator?.gate === "hard";
    });
  const revoked = hasRevokedDependency(envelope, options);
  const needsRevalidation = artifactNeedsRevalidation(envelope, expectedHardValidatorVersions, authoritative.complete, options);
  const canGenerate = !options.offline && documentAccess && !needsRevalidation;

  if (!needsRevalidation && expectedValidatorSetComplete) {
    return artifactState(envelope, {
      canGenerate,
      canRender: documentAccess,
      canRenderSafePreview: false,
      status: envelope.status
    });
  }

  if (!revoked && !options.offline && documentAccess && expectedValidatorSetComplete && options.revalidationService) {
    try {
      const outcome = await options.revalidationService.revalidate({
        artifact: envelope.artifact,
        artifactIndex: envelope.artifactIndex,
        expectedHardValidatorVersions
      }, options.signal);
      if (outcome.outcome === "pass" && dependencyVersionsCurrent(envelope, options)) {
        return artifactState({
          ...envelope,
          artifactIndex: {
            ...envelope.artifactIndex,
            hardValidatorVersions: outcome.usedHardValidatorVersions
          }
        }, {
          canGenerate: !options.offline && documentAccess,
          canRender: true,
          canRenderSafePreview: false,
          status: envelope.status
        });
      }
    } catch {
      // A failed worker cannot authorize rendering a stale interactive artifact.
    }
  }

  return artifactState(envelope, {
    canGenerate,
    canRender: false,
    canRenderSafePreview: documentAccess && Boolean(envelope.safePreview),
    status: "needs_revalidation"
  });
}

function hasRevokedDependency(
  envelope: VisualizationArtifactEnvelope,
  options: Pick<VisualizationArtifactLoadOptions, "revokedKernelIds" | "revokedRendererIds" | "revokedValidatorIds">
): boolean {
  return (options.revokedRendererIds ?? []).includes(envelope.artifact.implementation.rendererId)
    || (options.revokedValidatorIds ?? []).some((id) => id in envelope.artifactIndex.hardValidatorVersions)
    || (envelope.artifact.implementation.kernelId !== undefined
      && (options.revokedKernelIds ?? []).includes(envelope.artifact.implementation.kernelId));
}

function artifactNeedsRevalidation(
  envelope: VisualizationArtifactEnvelope,
  expectedHardValidatorVersions: Record<string, string>,
  authoritativeComplete: boolean,
  options: Pick<VisualizationArtifactLoadOptions, "currentKernelVersions" | "revokedKernelIds" | "revokedRendererIds" | "revokedValidatorIds">
): boolean {
  const artifactValidatorIds = new Set(Object.keys(envelope.artifactIndex.hardValidatorVersions));
  const expectedValidatorIds = Object.keys(expectedHardValidatorVersions);
  const validatorSetChanged = expectedValidatorIds.some((id) => !artifactValidatorIds.has(id))
    || [...artifactValidatorIds].some((id) => !expectedValidatorIds.includes(id));
  const validatorChanged = validatorSetChanged || !authoritativeComplete || Object.entries(envelope.artifactIndex.hardValidatorVersions)
    .some(([id, version]) => expectedHardValidatorVersions[id] !== version);
  const validatorRevoked = (options.revokedValidatorIds ?? [])
    .some((id) => id in envelope.artifactIndex.hardValidatorVersions);
  const rendererRegistration = getVisualizationRendererRegistration(envelope.artifact.implementation.rendererId);
  const rendererChanged = !rendererRegistration
    || rendererRegistration.version !== envelope.artifactIndex.rendererVersion;
  const rendererRevoked = (options.revokedRendererIds ?? [])
    .includes(envelope.artifact.implementation.rendererId);
  const kernelId = envelope.artifact.implementation.kernelId;
  const kernelRegistration = kernelId ? getVisualizationKernelRegistration(kernelId) : undefined;
  const expectedKernelVersion = kernelId ? options.currentKernelVersions?.[kernelId] ?? kernelRegistration?.version : undefined;
  const kernelChanged = Boolean(kernelId && (!envelope.artifactIndex.kernelVersion || !kernelRegistration || expectedKernelVersion !== envelope.artifactIndex.kernelVersion));
  const kernelRevoked = Boolean(kernelId && (options.revokedKernelIds ?? []).includes(kernelId));
  return validatorChanged || validatorRevoked || rendererChanged || rendererRevoked || kernelChanged || kernelRevoked;
}

function dependencyVersionsCurrent(
  envelope: VisualizationArtifactEnvelope,
  options: Pick<VisualizationArtifactLoadOptions, "currentKernelVersions">
): boolean {
  const implementation = envelope.artifact.implementation;
  const renderer = getVisualizationRendererRegistration(implementation.rendererId);
  if (!renderer
    || renderer.version !== implementation.rendererVersion
    || renderer.version !== envelope.artifactIndex.rendererVersion) {
    return false;
  }

  if (!implementation.kernelId) return true;
  const kernel = getVisualizationKernelRegistration(implementation.kernelId);
  if (!kernel) return false;
  const currentVersion = options.currentKernelVersions?.[implementation.kernelId] ?? kernel.version;
  return kernel.version === currentVersion
    && currentVersion === implementation.kernelVersion
    && currentVersion === envelope.artifactIndex.kernelVersion;
}

function getAuthoritativeValidatorVersions(index: VisualizationArtifactIndex): {
  complete: boolean;
  versions: Record<string, string>;
} {
  const versions: Record<string, string> = {};
  let complete = true;
  for (const id of Object.keys(index.hardValidatorVersions)) {
    const validator = getVisualizationValidator(id);
    if (!validator || validator.gate !== "hard") {
      complete = false;
      continue;
    }
    versions[id] = validator.version;
  }
  return { complete, versions };
}

function artifactState(
  envelope: VisualizationArtifactEnvelope,
  state: Omit<VisualizationArtifactState, "artifact" | "artifactIndex" | "safePreview">
): VisualizationArtifactState {
  return {
    artifact: envelope.artifact,
    artifactIndex: envelope.artifactIndex,
    ...state,
    safePreview: envelope.safePreview
  };
}

export function isGeneratedVisualizationModality(modality: VisualizationModality): boolean {
  return modality !== "source_figure";
}
