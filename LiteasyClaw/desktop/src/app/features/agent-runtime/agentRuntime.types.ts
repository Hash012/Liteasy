import type { AccountSession } from "../account/account.types";
import type { ArtifactType } from "../artifacts/artifact.types";
import type { AssistantMode } from "../assistant/assistant.types";
import type { OrganizationSummary } from "../organization/organization.types";
import type { SelectedDocumentSetSnapshot } from "../selection/selection.types";
import type { SettingsState } from "../settings/settings.types";
import type { ActionContext } from "../skills/actionRegistry";
import type { SkillInvocation } from "../skills/skillRegistry";
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

export type AgentRuntimeInput = {
  message: string;
  mode: AssistantMode;
};

export type AgentIntentId =
  | "settings.update"
  | "organization.open_shared_library"
  | "artifact.generate"
  | "unknown";

export type RuntimeSkillPlan = {
  intentId: Exclude<AgentIntentId, "artifact.generate" | "unknown">;
  kind: "skill";
  skill: SkillInvocation;
};

export type RuntimeArtifactPlan = {
  artifact: {
    artifactType: ArtifactType;
    payload: {
      source: "selected_document_set";
    };
  };
  intentId: "artifact.generate";
  kind: "artifact";
};

export type RuntimeUnknownPlan = {
  intentId: "unknown";
  kind: "unknown";
  message: string;
};

export type AgentRuntimePlan = RuntimeArtifactPlan | RuntimeSkillPlan | RuntimeUnknownPlan;

export type AgentRuntimeExecutionContext = ActionContext & {
  profileUnlocked?: boolean;
};

export type AgentRuntimeEvent =
  | { message: string; type: "assistant_reply" }
  | { missing: string[]; question: string; type: "clarification_request" }
  | { action: ActionRequest; summary: string; type: "confirmation_request" }
  | { action: ActionRequest; type: "action_request" }
  | { task: TaskRequest; type: "task_request" }
  | { artifact: ArtifactRequest; type: "artifact_request" }
  | { message: string; recovery?: string; type: "runtime_error" };

export type RuntimeExecutionResult = {
  events: AgentRuntimeEvent[];
  settingsChanged: boolean;
};

export type AgentContextValidation =
  | { ok: true }
  | {
      missing: string[];
      ok: false;
    };
