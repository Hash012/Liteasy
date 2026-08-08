import { z } from "zod";
import { parseVisualizationArtifact } from "./visualizationArtifact.schema";
import type { VisualizationArtifactV1, VisualizationModality } from "./visualizationArtifact.types";
import { getVisualizationRendererRegistration } from "./visualizationRendererRegistry";

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

export type VisualizationHardGateRevalidation = (input: {
  artifact: VisualizationArtifactV1;
  artifactIndex: VisualizationArtifactIndex;
}) => Promise<"pass" | "fail"> | "pass" | "fail";

export type VisualizationArtifactLoadOptions = {
  currentValidatorVersions?: Record<string, string>;
  documentAccess?: boolean;
  offline?: boolean;
  revalidateHardGates?: VisualizationHardGateRevalidation;
  revokedRendererIds?: readonly string[];
  revokedValidatorIds?: readonly string[];
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
  hardValidatorVersions: z.record(z.string().min(1), z.string().min(1)),
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
  const needsRevalidation = artifactNeedsRevalidation(envelope, options);
  const canGenerate = !options.offline && documentAccess && !needsRevalidation;

  if (!needsRevalidation) {
    return artifactState(envelope, {
      canGenerate,
      canRender: documentAccess,
      canRenderSafePreview: false,
      status: envelope.status
    });
  }

  if (!options.offline && documentAccess && options.revalidateHardGates) {
    try {
      const outcome = await options.revalidateHardGates({
        artifact: envelope.artifact,
        artifactIndex: envelope.artifactIndex
      });
      if (outcome === "pass") {
        return artifactState({
          ...envelope,
          artifactIndex: currentArtifactIndex(envelope, options)
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

function artifactNeedsRevalidation(
  envelope: VisualizationArtifactEnvelope,
  options: VisualizationArtifactLoadOptions
): boolean {
  const validatorChanged = Object.entries(options.currentValidatorVersions ?? {}).some(([id, version]) =>
    id in envelope.artifactIndex.hardValidatorVersions
      && envelope.artifactIndex.hardValidatorVersions[id] !== version
  );
  const validatorRevoked = (options.revokedValidatorIds ?? [])
    .some((id) => id in envelope.artifactIndex.hardValidatorVersions);
  const rendererRegistration = getVisualizationRendererRegistration(envelope.artifact.implementation.rendererId);
  const rendererChanged = !rendererRegistration
    || rendererRegistration.version !== envelope.artifactIndex.rendererVersion;
  const rendererRevoked = (options.revokedRendererIds ?? [])
    .includes(envelope.artifact.implementation.rendererId);
  return validatorChanged || validatorRevoked || rendererChanged || rendererRevoked;
}

function currentArtifactIndex(
  envelope: VisualizationArtifactEnvelope,
  options: VisualizationArtifactLoadOptions
): VisualizationArtifactIndex {
  const rendererVersion = getVisualizationRendererRegistration(envelope.artifact.implementation.rendererId)?.version
    ?? envelope.artifactIndex.rendererVersion;
  return {
    ...envelope.artifactIndex,
    hardValidatorVersions: {
      ...envelope.artifactIndex.hardValidatorVersions,
      ...Object.fromEntries(Object.entries(options.currentValidatorVersions ?? {})
        .filter(([id]) => id in envelope.artifactIndex.hardValidatorVersions))
    },
    rendererVersion
  };
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
