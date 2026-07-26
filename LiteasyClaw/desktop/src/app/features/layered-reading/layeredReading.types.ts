import type { SemanticLevel } from "../intuition-graph/intuitionGraph.types";

export type GraphRadius = 1 | 2 | 3;
export type SemanticLevelPreference = "auto" | SemanticLevel;

export type GraphViewState = {
  focusNodeId?: string;
  graphRadius: GraphRadius;
  hiddenKinds: string[];
  semanticLevel: SemanticLevelPreference;
};

export const defaultGraphViewState: GraphViewState = {
  graphRadius: 1,
  hiddenKinds: [],
  semanticLevel: "auto"
};
