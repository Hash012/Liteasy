export type SceneNodeV1 = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role?: string;
  evidenceClaimIds?: readonly string[];
};

export type SceneEdgeV1 = {
  id: string;
  from: string;
  to: string;
  label?: string;
  factual?: boolean;
  evidenceClaimIds?: readonly string[];
};

export type SvgSceneV1 = {
  width: number;
  height: number;
  nodes: readonly SceneNodeV1[];
  edges: readonly SceneEdgeV1[];
  svg: string;
};

export type StableLayoutNodeInput = {
  id: string;
  label?: string;
  width?: number;
  height?: number;
};

export type StableLayoutEdgeInput = {
  id: string;
  from: string;
  to: string;
  label?: string;
  factual?: boolean;
};

export type StableLayoutInput = {
  nodes: readonly StableLayoutNodeInput[];
  edges: readonly StableLayoutEdgeInput[];
  width?: number;
  height?: number;
};

export type StableLayoutDiagnosticV1 = {
  code: "layout_cycle_detected" | "layout_reference_invalid" | "layout_overlap_unresolved";
  objectIds: readonly string[];
};

export type StableLayoutResultV1 = {
  width: number;
  height: number;
  nodes: readonly SceneNodeV1[];
  edges: readonly SceneEdgeV1[];
  diagnostics: readonly StableLayoutDiagnosticV1[];
};
