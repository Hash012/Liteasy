export const intuitionGraphVersion = "liteasy-intuition-graph/v1" as const;
export const intuitionGraphPatchVersion = "liteasy-intuition-graph-patch/v1" as const;

export type SemanticLevel = 0 | 1 | 2 | 3 | 4;

export type IntuitionGraphNodeKind =
  | "thesis"
  | "historical_coordinate"
  | "intuition"
  | "concept"
  | "mechanism"
  | "derivation"
  | "experiment"
  | "limitation"
  | "evidence"
  | "gap";

export type IntuitionGraphEdgeKind =
  | "expands"
  | "explains"
  | "supports"
  | "contradicts"
  | "requires"
  | "compares"
  | "derived_from"
  | "intuits"
  | "cites";

export type GraphNodeSource =
  | { type: "paper"; analysisRunId: string }
  | { type: "community"; intuitionNoteId: string; authorId: string }
  | { type: "user"; localNoteId: string }
  | { type: "system"; ruleId: string };

export type IntuitionGraphStubNode = {
  id: string;
  status: "stub";
  label: string;
  suggestedLevel?: SemanticLevel;
  expandable: true;
  tags: string[];
};

export type IntuitionGraphCompleteNode = {
  id: string;
  status: "complete";
  kind: IntuitionGraphNodeKind;
  baseLevel: SemanticLevel;
  label: string;
  summary: string;
  hover?: {
    text: string;
    evidenceIds?: string[];
    prerequisiteNodeIds?: string[];
  };
  evidenceIds: string[];
  source: GraphNodeSource;
  confidence?: number;
  expandable: boolean;
  tags: string[];
};

export type IntuitionGraphNode = IntuitionGraphStubNode | IntuitionGraphCompleteNode;

export type IntuitionGraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: IntuitionGraphEdgeKind;
  label?: string;
  hover?: string;
  evidenceIds: string[];
};

export type GraphProvenance = {
  createdAt: string;
  generatedBy: "rule" | "model" | "user";
  analysisRunId?: string;
  traceId?: string;
};

export type IntuitionGraphDocument = {
  version: typeof intuitionGraphVersion;
  id: string;
  workId: string;
  rootNodeId: string;
  revision: number;
  nodes: IntuitionGraphNode[];
  edges: IntuitionGraphEdge[];
  provenance: GraphProvenance;
};

export type IntuitionGraphPatch = {
  version: typeof intuitionGraphPatchVersion;
  graphId: string;
  baseRevision: number;
  requestId: string;
  focusNodeId: string;
  targetLevel: SemanticLevel;
  upsertNodes: IntuitionGraphNode[];
  upsertEdges: IntuitionGraphEdge[];
  removeNodeIds: string[];
  removeEdgeIds: string[];
  explanation: string;
};

export type GraphValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: string[] };
