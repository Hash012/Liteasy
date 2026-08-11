export const generatedVisualizationModalities = [
  "semantic_graph",
  "circuit",
  "physics_diagram",
  "biology_structure",
  "geometry_2d",
  "function_plot",
  "geometry_3d",
  "physics_process",
  "reaction_process",
  "raster_illustration"
] as const;

export type GeneratedVisualizationModality = typeof generatedVisualizationModalities[number];
export type VisualizationModality = GeneratedVisualizationModality | "source_figure";

export type NormalizedBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EvidenceBindingV1 = {
  claimId: string;
  evidenceIds: string[];
  sourceFigureId?: string;
  sourceRegion?: NormalizedBoundingBox;
  confidence: "direct" | "derived" | "contextual";
};

export type SemanticObjectV1 = {
  objectId: string;
  kind: string;
  label: string;
  objectPath: string[];
  evidenceClaimIds: string[];
  selectable: boolean;
};

export type SemanticGraphSpecV1 = {
  subtype: "flowchart" | "mindmap" | "causal_graph" | "timeline";
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    objectPath: string[];
    evidenceClaimIds?: string[];
    position?: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    kind: "content" | "layout" | "supports" | "causes" | "precedes";
    label?: string;
    evidenceClaimIds?: string[];
  }>;
  groups: Array<{ id: string; label: string; memberIds: string[] }>;
  hierarchy: Array<{ parentId: string; childId: string }>;
  timeOrder: string[];
  claims: Array<{ id: string; text: string; evidenceIds: string[] }>;
};

export type CircuitSpecV1 = {
  components: Array<{ id: string; kind: string; position: [number, number]; ports: Array<{ id: string; name: string; position: [number, number] }>; evidenceClaimIds: string[] }>;
  wires: Array<{ id: string; from: string; to: string; evidenceClaimIds: string[] }>;
  networks: Array<{ id: string; memberIds: string[] }>;
  parameters: Array<{ id: string; value: number; unit: string; evidenceClaimIds: string[] }>;
  measurementPoints: Array<{ id: string; nodeId: string; evidenceClaimIds: string[] }>;
  currents: Array<{ nodeId: string; values: number[] }>;
  voltages: Array<{ componentId: string; value: number; unit: string }>;
};

export type PhysicsDiagramSpecV1 = {
  objects: Array<{ id: string; kind: string; position: [number, number]; label?: string; evidenceClaimIds: string[] }>;
  vectors: Array<{ id: string; objectId: string; direction: [number, number]; magnitude?: number; unit?: string; evidenceClaimIds: string[] }>;
  rays: Array<{ id: string; from: [number, number]; to: [number, number]; evidenceClaimIds: string[] }>;
  constraints: Array<{ id: string; kind: string; objectIds: string[]; evidenceClaimIds: string[] }>;
  annotations: Array<{ id: string; text: string; objectId?: string; evidenceClaimIds: string[] }>;
};

export type BiologyStructureSpecV1 = {
  ontologyVersion: string;
  structures: Array<{ id: string; ontologyId: string; label: string; parentId?: string; evidenceClaimIds: string[] }>;
  regions: Array<{ id: string; structureId: string; label: string; evidenceClaimIds: string[] }>;
  connections: Array<{ id: string; from: string; to: string; direction?: string; label?: string; evidenceClaimIds: string[] }>;
};

export type Geometry2DSpecV1 = {
  objects: Array<{ id: string; kind: "point" | "line" | "segment" | "circle" | "arc" | "polygon" | "curve"; data: Record<string, number | string | number[]>; evidenceClaimIds: string[] }>;
  constraints: Array<{ id: string; kind: string; objectIds: string[]; evidenceClaimIds: string[] }>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
};

export type FunctionPlotSpecV1 = {
  expression: string;
  variable: string;
  domain: { min: number; max: number };
  parameters: Array<{ id: string; value: number; min: number; max: number; unit?: string; evidenceClaimIds: string[] }>;
  axes: { xLabel: string; yLabel: string };
  keyPoints: Array<{ id: string; x: number; y: number; label?: string; evidenceClaimIds: string[] }>;
  auxiliaryCurves: Array<{ id: string; expression: string; evidenceClaimIds: string[] }>;
};

export type Geometry3DSpecV1 = {
  objects: Array<{ id: string; kind: string; vertices: Array<[number, number, number]>; faces?: Array<number[]>; evidenceClaimIds: string[] }>;
  constraints: Array<{ id: string; kind: string; objectIds: string[]; evidenceClaimIds: string[] }>;
  sections: Array<{ id: string; objectId: string; plane: [number, number, number, number]; evidenceClaimIds: string[] }>;
  camera: { position: [number, number, number]; target: [number, number, number]; minDistance: number; maxDistance: number };
};

export type PhysicsProcessSpecV1 = {
  duration: number;
  frameRate: number;
  initialState: Record<string, number>;
  parameters: Array<{ id: string; value: number; unit: string; min: number; max: number; evidenceClaimIds: string[] }>;
  equations: Array<{ id: string; expression: string; evidenceClaimIds: string[] }>;
  events: Array<{ id: string; time: number; label: string; evidenceClaimIds: string[] }>;
  invariants: Array<{ id: string; expression: string; evidenceClaimIds: string[] }>;
  errorTolerance: number;
  evidenceBindings: string[];
  seed?: string;
};

export type ReactionProcessSpecV1 = {
  species: Array<{ id: string; formula: string; state: "s" | "l" | "g" | "aq"; evidenceClaimIds: string[] }>;
  steps: Array<{ id: string; reactants: Array<{ speciesId: string; coefficient: number }>; products: Array<{ speciesId: string; coefficient: number }>; mechanism?: Array<{ id: string; label: string; evidenceClaimIds: string[] }>; evidenceClaimIds: string[] }>;
  conditions: Array<{ id: string; label: string; value?: string; evidenceClaimIds: string[] }>;
  atomMap: Array<{
    id: string;
    stepId?: string;
    fromSpeciesId: string;
    fromMolecule?: number;
    fromAtom: number;
    toSpeciesId: string;
    toMolecule?: number;
    toAtom: number;
    evidenceClaimIds: string[];
  }>;
};

export type RasterIllustrationSpecV1 = {
  visualSchema: string;
  composition: { width: number; height: number; aspectRatio: number };
  labels: Array<{ id: string; text: string; evidenceClaimIds: string[] }>;
  styleLock: { palette: string[]; typography: string; prohibitDecorativeClaims: boolean; allowTransparency?: boolean };
  evidenceClaimIds: string[];
  asset?: {
    assetRef: string;
    byteLength: number;
    height: number;
    labelVerification: { engine: string; verifiedLabelIds: string[] };
    mimeType: "image/png";
    sha256: string;
    width: number;
  };
};

export type SourceFigureRefV1 = {
  sourceFigureId: string;
  paperId: string;
  page: number;
  caption: string;
  imageRef: string;
  regions: Array<{ id: string; bbox: NormalizedBoundingBox; evidenceIds: string[] }>;
  extraction: { method: string; confidence: number };
};

export type VisualizationSpecV1 =
  | { modality: "semantic_graph"; payload: SemanticGraphSpecV1 }
  | { modality: "circuit"; payload: CircuitSpecV1 }
  | { modality: "physics_diagram"; payload: PhysicsDiagramSpecV1 }
  | { modality: "biology_structure"; payload: BiologyStructureSpecV1 }
  | { modality: "geometry_2d"; payload: Geometry2DSpecV1 }
  | { modality: "function_plot"; payload: FunctionPlotSpecV1 }
  | { modality: "geometry_3d"; payload: Geometry3DSpecV1 }
  | { modality: "physics_process"; payload: PhysicsProcessSpecV1 }
  | { modality: "reaction_process"; payload: ReactionProcessSpecV1 }
  | { modality: "raster_illustration"; payload: RasterIllustrationSpecV1 }
  | { modality: "source_figure"; payload: SourceFigureRefV1 };

export type InteractionContractV1 = {
  pan: boolean;
  zoom: boolean;
  rotate: boolean;
  playback: "none" | "timeline" | "stepwise";
  parameterIds: string[];
  selectableObjectIds: string[];
};

export type AccessibilityProjectionV1 = {
  summary: string;
  objectReadingOrder: string[];
  dataTable?: Array<{ label: string; value: string }>;
};

export type ValidationReportV1 = {
  outcome: "pass" | "degraded" | "fail";
  checks: Array<{ gate: "hard" | "advisory"; validatorId: string; validatorVersion: string; outcome: "pass" | "warning" | "fail"; diagnosticCode?: string }>;
  repairCount: 0 | 1;
};

export type FallbackRecordV1 = { from: VisualizationModality; to?: VisualizationModality; reasonCode: string };

export type UsageRecordLinkV1 = {
  ledgerId: string;
  reservationId: string;
  providerRouteId: string;
  costPolicyVersion: string;
  reservedUnits: number;
  settledUnits: number;
};

export type VisualizationArtifactV1 = {
  artifactId: string;
  artifactVersion: "liteasy.visualization/v1";
  modality: VisualizationModality;
  nodeId: string;
  locale: string;
  spec: VisualizationSpecV1;
  implementation: { skillId: string; skillVersion: string; rendererId: string; rendererVersion: string; kernelId?: string; kernelVersion?: string };
  evidenceBindings: EvidenceBindingV1[];
  semanticObjects: SemanticObjectV1[];
  interaction: InteractionContractV1;
  accessibility: AccessibilityProjectionV1;
  validation: ValidationReportV1;
  fallbackHistory: FallbackRecordV1[];
  usage: UsageRecordLinkV1;
  createdAt: string;
};

export type ViewportSnapshot = { x: number; y: number; width: number; height: number; scale: number };

export type DeepDiveTargetV1 =
  | { kind: "generated_object"; nodeId: string; artifactId: string; objectId: string; objectPath: string[]; evidenceClaimIds: string[]; viewport?: ViewportSnapshot }
  | { kind: "source_figure"; nodeId: string; sourceFigureId: string; evidenceIds: string[] }
  | { kind: "source_region"; nodeId: string; sourceFigureId: string; bbox: NormalizedBoundingBox; sourcePixelSize: { width: number; height: number }; evidenceIds: string[] };
