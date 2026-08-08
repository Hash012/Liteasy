import type { UIDslDataSourceId } from "./generativeUi.types";
import type { Citation } from "../retrieval/retrieval.types";

export type DataSourceCard = {
  riskLevel: "low" | "medium";
  sourceId: UIDslDataSourceId;
};

export type ProfileSummaryData = {
  basis: string[];
  enabled: boolean;
  fields: string[];
};

export type UIDslDataSourceResolverContext = {
  artifactTasks?: unknown[];
  citations?: Citation[];
  contextView?: unknown;
  organizationSummary?: unknown;
  profileSummary?: ProfileSummaryData;
  selectedDocumentSetSummary?: unknown;
  workspaceCurrent?: unknown;
};

const dataSourceCards: DataSourceCard[] = [
  { riskLevel: "low", sourceId: "artifact.tasks" },
  { riskLevel: "medium", sourceId: "organization.summary" },
  { riskLevel: "medium", sourceId: "profile.summary" },
  { riskLevel: "low", sourceId: "retrieval.citations" },
  { riskLevel: "low", sourceId: "runtime.context_view" },
  { riskLevel: "low", sourceId: "selected_document_set.summary" },
  { riskLevel: "low", sourceId: "workspace.current" }
];

export function getDataSourceCards(): DataSourceCard[] {
  return dataSourceCards.map((card) => ({ ...card }));
}

export function hasDataSource(sourceId: string) {
  return dataSourceCards.some((card) => card.sourceId === sourceId);
}

export function resolveUIDslDataSource(
  ref: {
    sourceId: UIDslDataSourceId;
  },
  context: UIDslDataSourceResolverContext
) {
  if (ref.sourceId === "retrieval.citations") {
    return context.citations ?? [];
  }

  if (ref.sourceId === "profile.summary") {
    return context.profileSummary ?? {
      basis: [],
      enabled: false,
      fields: []
    };
  }

  if (ref.sourceId === "runtime.context_view") {
    return context.contextView ?? null;
  }

  if (ref.sourceId === "artifact.tasks") {
    return context.artifactTasks ?? [];
  }

  if (ref.sourceId === "organization.summary") {
    return context.organizationSummary ?? null;
  }

  if (ref.sourceId === "selected_document_set.summary") {
    return context.selectedDocumentSetSummary ?? null;
  }

  return context.workspaceCurrent ?? null;
}
