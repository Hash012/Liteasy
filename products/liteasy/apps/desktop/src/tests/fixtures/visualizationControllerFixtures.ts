import { vi } from "vitest";
import type { MultimodalVisualizationCapability } from "../../app/features/account/accountCapabilitiesClient";
import type { ThinReadingDocumentV2, ThinReadingNodeV2 } from "../../app/features/thin-reading/thinReading.types";
import type { VisualizationArtifactV1 } from "../../app/features/visualization/visualizationArtifact.types";
import { makeVisualizationArtifactFixture } from "./visualizationArtifactFixtures";

export const availableCapability: MultimodalVisualizationCapability = {
  allowed: true,
  availableModalities: ["semantic_graph"],
  enabled: true,
  explicitRequestsAllowed: true,
  quota: { available: true },
  serviceAvailable: true
};

export const readyArtifact = {
  ...makeVisualizationArtifactFixture({ modality: "semantic_graph" }),
  artifactId: "visual-ready-1",
  nodeId: "node-root"
} as VisualizationArtifactV1;

export const nodeWithIntent: ThinReadingNodeV2 = {
  childIds: [],
  createdAt: "2026-08-09T08:00:00.000Z",
  depth: 0,
  evidence: {
    externalKnowledge: [],
    paperEvidence: ["evidence-1"]
  },
  id: "node-root",
  omittedSections: [],
  recommendationScope: { kind: "whole_paper", paperId: "paper-1" },
  recommendations: [],
  source: { kind: "root_overview" },
  summary: "The mechanism has two evidence-backed stages.",
  title: "Overview",
  visualizationDecision: {
    intent: {
      candidateModalities: ["semantic_graph"],
      evidenceIds: ["evidence-1"],
      expectedLearningGain: "high",
      nodeId: "node-root",
      purpose: "show_process",
      requestedBy: "automatic"
    },
    status: "accepted"
  },
  visualizations: [],
  withinPaperClosure: true
};

export function documentWithNode(
  node: ThinReadingNodeV2 = nodeWithIntent
): ThinReadingDocumentV2 {
  return {
    activeNodeId: node.id,
    annotationSettings: { autoPublic: false },
    annotations: [],
    artifactId: "thin-1",
    nodes: { [node.id]: node },
    paperIds: ["paper-1"],
    pendingPublicAnnotationIds: [],
    rootNodeId: node.id,
    targetLanguage: "en",
    title: "Thin reading",
    version: "liteasy.thin-reading/v2"
  };
}

export const saveThinReadingDocument = vi.fn(async () => undefined);
export const generateVisualization = vi.fn(async (): Promise<readonly VisualizationArtifactV1[]> => [
  readyArtifact
]);
export const cancelGeneration = vi.fn(async () => undefined);

export function resetVisualizationControllerSpies() {
  saveThinReadingDocument.mockReset().mockResolvedValue(undefined);
  generateVisualization.mockReset().mockResolvedValue([readyArtifact]);
  cancelGeneration.mockReset().mockResolvedValue(undefined);
}
