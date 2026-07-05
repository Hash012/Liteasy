import type { ActionInvocation } from "../skills/actionRegistry";

export type UIDslSurface = "assistant" | "center_artifact" | "workbench_overlay";

export type UIDslComponentName =
  | "ActionBar"
  | "ArtifactLauncher"
  | "CitationList"
  | "ComparisonTable"
  | "EvidenceCard"
  | "EvidenceMatrix"
  | "MindMap"
  | "Panel"
  | "SlideDeck"
  | "Stack"
  | "StatusBanner"
  | "TreeOutline";

export type UIDslDataSourceId =
  | "artifact.tasks"
  | "organization.summary"
  | "profile.summary"
  | "retrieval.citations"
  | "runtime.context_view"
  | "selected_document_set.summary"
  | "workspace.current";

export type UIDslRiskLevel = "low" | "medium" | "high";

export type UIDslActionRef = {
  actionId: ActionInvocation["actionId"];
  id: string;
  input: Record<string, unknown>;
  label: string;
  riskLevel: UIDslRiskLevel;
};

export type UIDslDataSourceRef = {
  id: string;
  params: Record<string, unknown>;
  sourceId: UIDslDataSourceId;
};

export type UIDslNode = {
  children?: UIDslNode[];
  component: UIDslComponentName;
  id: string;
  props: Record<string, unknown>;
};

export type UIDslDocument = {
  actions: UIDslActionRef[];
  audit: {
    createdAt: string;
    generatedBy: "model" | "rule";
    model?: string;
    traceId: string;
  };
  dataSources: UIDslDataSourceRef[];
  id: string;
  intentPlanId: string;
  root: UIDslNode;
  surface: UIDslSurface;
  version: "liteasy-ui-dsl/v1";
};

export type UIDslValidationResult = {
  errors: string[];
  valid: boolean;
};
