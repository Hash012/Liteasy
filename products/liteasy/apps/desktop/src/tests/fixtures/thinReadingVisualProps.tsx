import type { MineruFigure } from "../../app/features/import/import.types";
import type { MultimodalVisualizationCapability } from "../../app/features/account/accountCapabilitiesClient";
import type { ThinReadingTabProps } from "../../app/features/thin-reading/ThinReadingTab";
import { createThinReadingDocument } from "../../app/features/thin-reading/thinReadingProjection";
import type { ThinReadingDocumentV2 } from "../../app/features/thin-reading/thinReading.types";
import type { VisualizationArtifactV1 } from "../../app/features/visualization/visualizationArtifact.types";
import { parseVisualizationArtifact } from "../../app/features/visualization/visualizationArtifact.schema";
import { createThinReadingFixture } from "./thinReadingFixtures";
import { makeVisualizationArtifactFixture } from "./visualizationArtifactFixtures";

const allowedCapability: MultimodalVisualizationCapability = {
  allowed: true,
  availableModalities: ["semantic_graph"],
  enabled: true,
  explicitRequestsAllowed: true,
  quota: { available: true },
  serviceAvailable: true
};

const unavailableCapability: MultimodalVisualizationCapability = {
  allowed: false,
  availableModalities: [],
  enabled: false,
  explicitRequestsAllowed: false,
  quota: { available: false },
  serviceAvailable: false
};

const sourceFigure: MineruFigure = {
  alt: "论文架构图",
  dataUrl: "data:image/png;base64,fixture",
  id: "figure-fixture",
  page: 3,
  sourcePath: "/papers/fixture.pdf"
};

const visualArtifact = parseVisualizationArtifact(makeVisualizationArtifactFixture()) as VisualizationArtifactV1;
const baseDocument = createThinReadingDocument(createThinReadingFixture()) as ThinReadingDocumentV2;
const documentWithVisual = {
  ...baseDocument,
  nodes: {
    ...baseDocument.nodes,
    [baseDocument.rootNodeId]: {
      ...baseDocument.nodes[baseDocument.rootNodeId],
      visualizations: [visualArtifact]
    }
  }
} satisfies ThinReadingDocumentV2;

export const propsWithVisualAndFigure: ThinReadingTabProps = {
  artifactId: documentWithVisual.artifactId,
  document: documentWithVisual,
  figures: [sourceFigure],
  onToggleVisualization: () => undefined,
  onUpdateDocument: () => undefined,
  papers: createThinReadingFixture().papers,
  visualizationCapability: allowedCapability,
  visualizationStatus: { artifacts: [visualArtifact], status: "ready" }
};

export const unauthorizedProps: ThinReadingTabProps = {
  ...propsWithVisualAndFigure,
  document: baseDocument,
  figures: [sourceFigure],
  onToggleVisualization: () => undefined,
  visualizationCapability: unavailableCapability,
  visualizationStatus: { reasonCode: "capability_unavailable", status: "omitted" }
};
