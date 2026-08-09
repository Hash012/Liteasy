import { parseVisualizationArtifact } from "../visualization/visualizationArtifact.schema";
import type {
  ThinReadingDocument,
  ThinReadingDocumentV1,
  ThinReadingDocumentV2,
  ThinReadingNodeV1,
  ThinReadingNodeV2
} from "./thinReading.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isThinReadingDocumentBase(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.artifactId === "string" && value.artifactId.trim().length > 0 &&
    typeof value.title === "string" && value.title.trim().length > 0 &&
    typeof value.targetLanguage === "string" && Array.isArray(value.paperIds) &&
    value.paperIds.every((id) => typeof id === "string" && id.trim().length > 0) &&
    typeof value.rootNodeId === "string" && typeof value.activeNodeId === "string" &&
    isRecord(value.nodes) && Array.isArray(value.annotations) &&
    Array.isArray(value.pendingPublicAnnotationIds) && isRecord(value.annotationSettings) &&
    typeof value.annotationSettings.autoPublic === "boolean" &&
    value.rootNodeId in value.nodes && value.activeNodeId in value.nodes;
}

function isV1Node(value: unknown): value is ThinReadingNodeV1 {
  return isRecord(value) && typeof value.id === "string" && typeof value.summary === "string" &&
    typeof value.title === "string" && typeof value.depth === "number" &&
    Array.isArray(value.childIds) && isRecord(value.evidence) &&
    Array.isArray(value.evidence.paperEvidence) && Array.isArray(value.evidence.externalKnowledge);
}

function parseV1(value: Record<string, unknown>): ThinReadingDocumentV1 {
  if (!isThinReadingDocumentBase(value) || value.version !== "liteasy.thin-reading/v1" ||
    !Object.values(value.nodes as Record<string, unknown>).every(isV1Node)) {
    throw new Error("thin_reading_document_invalid");
  }
  return value as unknown as ThinReadingDocumentV1;
}

function parseV2(value: Record<string, unknown>): ThinReadingDocumentV2 {
  if (!isThinReadingDocumentBase(value) || value.version !== "liteasy.thin-reading/v2" ||
    !Object.values(value.nodes as Record<string, unknown>).every((node) => {
      if (!isRecord(node) || !Array.isArray(node.visualizations) || !isRecord(node.evidence)) {
        return false;
      }
      try {
        node.visualizations.forEach((artifact) => parseVisualizationArtifact(artifact));
      } catch {
        return false;
      }
      return node.evidence.interactiveDemo === undefined && node.evidence.mermaid === undefined;
    })) {
    throw new Error("thin_reading_document_invalid");
  }
  return value as unknown as ThinReadingDocumentV2;
}

export function isThinReadingV1(value: unknown): value is ThinReadingDocumentV1 {
  return isRecord(value) && value.version === "liteasy.thin-reading/v1";
}

export function parseThinReadingDocument(value: unknown): ThinReadingDocument {
  if (!isRecord(value)) {
    throw new Error("thin_reading_document_invalid");
  }
  return value.version === "liteasy.thin-reading/v1" ? parseV1(value) : parseV2(value);
}

export function cloneThinReadingV1AsV2(
  value: unknown,
  input: { artifactId: string; createdAt: string }
): ThinReadingDocumentV2 {
  const oldDocument = parseV1(isRecord(value) ? value : {});
  const nodes = Object.fromEntries(Object.entries(oldDocument.nodes).map(([nodeId, node]) => {
    const { version: _version, ...nodeWithoutVersion } = node;
    const { interactiveDemo: _interactiveDemo, mermaid: _mermaid, ...evidence } = node.evidence;
    const nextNode: ThinReadingNodeV2 = {
      ...nodeWithoutVersion,
      evidence,
      visualizations: []
    } as unknown as ThinReadingNodeV2;
    return [nodeId, nextNode];
  }));
  const annotations = oldDocument.annotations.map((annotation) => ({
    ...annotation,
    artifactId: input.artifactId
  }));
  return {
    ...oldDocument,
    annotations,
    artifactId: input.artifactId,
    migrationProvenance: {
      migratedAt: input.createdAt,
      sourceArtifactId: oldDocument.artifactId
    },
    nodes,
    version: "liteasy.thin-reading/v2"
  };
}
