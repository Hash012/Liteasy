import type { AccountSession } from "../account/account.types";
import type { OrganizationSummary } from "../organization/organization.types";
import type { SelectedDocumentSetSnapshot } from "../selection/selection.types";
import type { SettingsState } from "../settings/settings.types";
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";

export type IngestionStatus = "not_started" | "queued" | "running" | "failed" | "ready";

export type IngestionSnapshot = {
  byDocumentId: Record<string, IngestionStatus>;
};

export type WorkspaceSnapshot = {
  papers: Paper[];
  revision: number;
  source: WorkspaceSource;
};

export type AgentContextSnapshot = {
  account: AccountSession | null;
  ingestion: IngestionSnapshot;
  organization: OrganizationSummary | null;
  selection: SelectedDocumentSetSnapshot;
  settings: SettingsState;
  workspace: WorkspaceSnapshot;
};

export type ActionRequest = {
  actionId: string;
  payload: Record<string, unknown>;
};

export type TaskRequest = {
  payload: Record<string, unknown>;
  taskType: string;
};

export type ArtifactRequest = {
  artifactType: string;
  payload: Record<string, unknown>;
};

export type AgentRuntimeEvent =
  | { message: string; type: "assistant_reply" }
  | { missing: string[]; question: string; type: "clarification_request" }
  | { action: ActionRequest; summary: string; type: "confirmation_request" }
  | { action: ActionRequest; type: "action_request" }
  | { task: TaskRequest; type: "task_request" }
  | { artifact: ArtifactRequest; type: "artifact_request" }
  | { message: string; recovery?: string; type: "runtime_error" };

export type AgentContextValidation =
  | { ok: true }
  | {
      missing: string[];
      ok: false;
    };
