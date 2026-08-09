import type { MineruFigure } from "../import/import.types";
import type {
  DeepDiveTargetV1,
  NormalizedBoundingBox,
  SemanticObjectV1,
  SourceFigureRefV1,
  VisualizationArtifactV1
} from "../visualization/visualizationArtifact.types";

type DisplayRect = { left: number; top: number; width: number; height: number };
type DragCoordinates = { startX: number; startY: number; endX: number; endY: number };

const MIN_REGION_SIZE = 0.01;

export function describeDeepDiveTarget(target: DeepDiveTargetV1): string {
  if (target.kind === "generated_object") {
    return `visual object ${target.objectPath.join(" / ") || target.objectId}`;
  }
  if (target.kind === "source_region") {
    return `figure ${target.sourceFigureId} region (${target.bbox.x.toFixed(3)}, ${target.bbox.y.toFixed(3)}, ${target.bbox.width.toFixed(3)}, ${target.bbox.height.toFixed(3)})`;
  }
  return `source figure ${target.sourceFigureId}`;
}

function requireText(value: string | undefined, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(code);
  }
  return value.trim();
}

function requireEvidenceIds(ids: readonly string[] | undefined, code: string): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    throw new Error(code);
  }
  return [...new Set(ids.map((id) => id.trim()))];
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function knownClaimIds(artifact: VisualizationArtifactV1): Set<string> {
  const ids = artifact.evidenceBindings.map((binding) => binding.claimId);
  const payload = artifact.spec.payload;
  if ("claims" in payload) ids.push(...payload.claims.map((claim) => claim.id));
  return new Set(ids);
}

function ensureArtifactObject(artifact: VisualizationArtifactV1, object: SemanticObjectV1): SemanticObjectV1 {
  if (artifact.validation.outcome !== "pass") {
    throw new Error("deep_dive_target_evidence_invalid");
  }
  const selected = artifact.semanticObjects.find((candidate) => candidate.objectId === object.objectId);
  const claimIds = requireEvidenceIds(object.evidenceClaimIds, "deep_dive_target_evidence_invalid");
  const claims = knownClaimIds(artifact);
  if (!selected || !selected.selectable || selected.objectPath.length === 0 ||
      claimIds.some((claimId) => !claims.has(claimId))) {
    throw new Error("deep_dive_target_evidence_invalid");
  }
  return selected;
}

export function createGeneratedObjectTarget(
  artifact: VisualizationArtifactV1,
  object: SemanticObjectV1
): Extract<DeepDiveTargetV1, { kind: "generated_object" }> {
  const selected = ensureArtifactObject(artifact, object);
  return {
    artifactId: requireText(artifact.artifactId, "deep_dive_target_artifact_invalid"),
    evidenceClaimIds: [...selected.evidenceClaimIds],
    kind: "generated_object",
    nodeId: requireText(artifact.nodeId, "deep_dive_target_node_invalid"),
    objectId: selected.objectId,
    objectPath: [...selected.objectPath]
  };
}

function sourceFigureIdentity(artifact: VisualizationArtifactV1 | undefined, sourceFigureId: string): void {
  const id = requireText(sourceFigureId, "deep_dive_target_source_figure_invalid");
  if (!artifact) return;
  if (artifact.validation.outcome !== "pass" || artifact.modality !== "source_figure" ||
      artifact.spec.modality !== "source_figure" || artifact.spec.payload.sourceFigureId !== id) {
    throw new Error("deep_dive_target_source_figure_invalid");
  }
}

function artifactEvidenceIds(artifact: VisualizationArtifactV1): Set<string> {
  const ids = artifact.evidenceBindings.flatMap((binding) => binding.evidenceIds);
  const payload = artifact.spec.payload;
  if (artifact.spec.modality === "source_figure") {
    const sourcePayload = payload as SourceFigureRefV1;
    ids.push(...sourcePayload.regions.flatMap((region) => region.evidenceIds));
  }
  return new Set(ids);
}

export function createSourceFigureTarget(input: {
  artifact?: VisualizationArtifactV1;
  evidenceIds: readonly string[];
  nodeId: string;
  sourceFigureId: string;
}): Extract<DeepDiveTargetV1, { kind: "source_figure" }> {
  sourceFigureIdentity(input.artifact, input.sourceFigureId);
  const evidenceIds = requireEvidenceIds(input.evidenceIds, "deep_dive_target_evidence_invalid");
  const artifact = input.artifact;
  if (artifact && evidenceIds.some((id) => !artifactEvidenceIds(artifact).has(id))) {
    throw new Error("deep_dive_target_evidence_invalid");
  }
  return {
    evidenceIds,
    kind: "source_figure",
    nodeId: requireText(input.nodeId, "deep_dive_target_node_invalid"),
    sourceFigureId: requireText(input.sourceFigureId, "deep_dive_target_source_figure_invalid")
  };
}

export function createSourceRegionTarget(input: {
  displayRect: DisplayRect;
  drag: DragCoordinates;
  evidenceIds: readonly string[];
  figureId: string;
  nodeId: string;
  sourcePixelSize: { width: number; height: number };
}): Extract<DeepDiveTargetV1, { kind: "source_region" }> {
  sourceFigureIdentity(undefined, input.figureId);
  const rect = input.displayRect;
  if (!finite(rect.left) || !finite(rect.top) ||
      !finitePositive(rect.width) || !finitePositive(rect.height) ||
      !finitePositive(input.sourcePixelSize.width) || !finitePositive(input.sourcePixelSize.height) ||
      ![input.drag.startX, input.drag.startY, input.drag.endX, input.drag.endY].every(finite)) {
    throw new Error("deep_dive_target_coordinates_invalid");
  }
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const startX = clamp(Math.min(input.drag.startX, input.drag.endX), rect.left, rect.left + rect.width);
  const endX = clamp(Math.max(input.drag.startX, input.drag.endX), rect.left, rect.left + rect.width);
  const startY = clamp(Math.min(input.drag.startY, input.drag.endY), rect.top, rect.top + rect.height);
  const endY = clamp(Math.max(input.drag.startY, input.drag.endY), rect.top, rect.top + rect.height);
  const bbox: NormalizedBoundingBox = {
    x: (startX - rect.left) / rect.width,
    y: (startY - rect.top) / rect.height,
    width: (endX - startX) / rect.width,
    height: (endY - startY) / rect.height
  };
  if (bbox.width < MIN_REGION_SIZE || bbox.height < MIN_REGION_SIZE) {
    throw new Error("deep_dive_target_coordinates_invalid");
  }
  return {
    bbox,
    evidenceIds: requireEvidenceIds(input.evidenceIds, "deep_dive_target_evidence_invalid"),
    kind: "source_region",
    nodeId: requireText(input.nodeId, "deep_dive_target_node_invalid"),
    sourceFigureId: requireText(input.figureId, "deep_dive_target_source_figure_invalid"),
    sourcePixelSize: { width: input.sourcePixelSize.width, height: input.sourcePixelSize.height }
  };
}

export function sourceFigurePixelSize(figure: MineruFigure): { width: number; height: number } {
  if (typeof Image === "undefined") return { width: 1, height: 1 };
  const image = new Image();
  image.src = figure.dataUrl;
  return {
    height: image.naturalHeight > 0 ? image.naturalHeight : 1,
    width: image.naturalWidth > 0 ? image.naturalWidth : 1
  };
}
