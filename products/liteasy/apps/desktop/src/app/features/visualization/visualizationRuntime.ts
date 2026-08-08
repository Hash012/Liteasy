import type { VisualizationArtifactV1, VisualizationModality } from "./visualizationArtifact.types";
import { getVisualizationRendererRegistration } from "./visualizationRendererRegistry";

export type VisualizationArtifactStatus = "ready" | "degraded" | "needs_revalidation" | "omitted";

export type VisualizationArtifactIndex = {
  evidenceHash?: string;
  hardValidatorVersions: Record<string, string>;
  rendererVersion?: string;
  skillVersion?: string;
  specHash?: string;
  kernelVersion?: string;
};

export type VisualizationArtifactRecord = VisualizationArtifactV1 & {
  artifactIndex?: Partial<VisualizationArtifactIndex>;
  evidenceHash?: string;
  hardValidatorSet?: Record<string, string> | Array<{ id: string; version: string }>;
  safePreview?: unknown;
  specHash?: string;
  status?: VisualizationArtifactStatus;
};

export type VisualizationArtifactLoadOptions = {
  currentValidatorVersions?: Record<string, string>;
  documentAccess?: boolean;
  offline?: boolean;
  revokedRendererIds?: readonly string[];
  revokedValidatorIds?: readonly string[];
};

export type VisualizationArtifactState = {
  artifact: VisualizationArtifactRecord;
  canGenerate: boolean;
  canRender: boolean;
  index: VisualizationArtifactIndex;
  safePreview?: unknown;
  status: VisualizationArtifactStatus;
};

export async function loadVisualizationArtifact(
  artifact: VisualizationArtifactRecord,
  options: VisualizationArtifactLoadOptions = {}
): Promise<VisualizationArtifactState> {
  const index = createArtifactIndex(artifact);
  const validatorChanged = Object.entries(options.currentValidatorVersions ?? {}).some(([id, version]) => {
    const stored = index.hardValidatorVersions[id];
    return stored !== version;
  });
  const validatorRevoked = (options.revokedValidatorIds ?? []).some((id) => id in index.hardValidatorVersions);
  const rendererRegistration = getVisualizationRendererRegistration(artifact.implementation.rendererId);
  const rendererChanged = rendererRegistration
    ? rendererRegistration.version !== artifact.implementation.rendererVersion
    : true;
  const rendererRevoked = (options.revokedRendererIds ?? []).includes(artifact.implementation.rendererId);
  const needsRevalidation = validatorChanged || validatorRevoked || rendererChanged || rendererRevoked;
  const documentAccess = options.documentAccess ?? true;
  const status = needsRevalidation ? "needs_revalidation" : artifact.status ?? "ready";

  return {
    artifact,
    canGenerate: !options.offline && documentAccess && !needsRevalidation,
    canRender: documentAccess && status !== "omitted",
    index,
    safePreview: artifact.safePreview,
    status
  };
}

function createArtifactIndex(artifact: VisualizationArtifactRecord): VisualizationArtifactIndex {
  const hardValidatorVersions = artifact.hardValidatorSet
    ? Array.isArray(artifact.hardValidatorSet)
      ? Object.fromEntries(artifact.hardValidatorSet.map(({ id, version }) => [id, version]))
      : artifact.hardValidatorSet
    : Object.fromEntries(
        artifact.validation.checks
          .filter((check) => check.gate === "hard")
          .map((check) => [check.validatorId, check.validatorVersion])
      );
  return {
    evidenceHash: artifact.artifactIndex?.evidenceHash ?? artifact.evidenceHash,
    hardValidatorVersions: artifact.artifactIndex?.hardValidatorVersions ?? hardValidatorVersions,
    kernelVersion: artifact.artifactIndex?.kernelVersion ?? artifact.implementation.kernelVersion,
    rendererVersion: artifact.artifactIndex?.rendererVersion ?? artifact.implementation.rendererVersion,
    skillVersion: artifact.artifactIndex?.skillVersion ?? artifact.implementation.skillVersion,
    specHash: artifact.artifactIndex?.specHash ?? artifact.specHash
  };
}

export function isGeneratedVisualizationModality(modality: VisualizationModality): boolean {
  return modality !== "source_figure";
}
