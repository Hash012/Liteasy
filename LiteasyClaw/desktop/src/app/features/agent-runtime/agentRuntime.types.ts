import type { AccountSession } from "../account/account.types";
import type { ArtifactType } from "../artifacts/artifact.types";
import type { AssistantMode } from "../assistant/assistant.types";
import type { OrganizationSummary } from "../organization/organization.types";
import type { SelectedDocumentSetSnapshot } from "../selection/selection.types";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import type { ActionContext, PanelActionTarget, RegisteredActionMetadata } from "../skills/actionRegistry";
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
  contextView?: AgentRuntimeContextView;
  profileUnlocked?: boolean;
  semanticPlanner?: SemanticCommandPlanner;
};

export type RuntimeContextIssue =
  | "selection_empty"
  | "selection_unlocked"
  | "documents_not_imported"
  | "workspace_unknown";

export type AgentRuntimeContextView = {
  cloud: {
    connected: boolean;
    organizationName?: string;
  };
  profile: {
    enabled: boolean;
    requiresConfirmation: boolean;
  };
  selection: {
    importedCount: number;
    issues: RuntimeContextIssue[];
    locked: boolean;
    ready: boolean;
    selectedCount: number;
  };
  workspace: {
    rootPath?: string;
    type: WorkspaceSource["type"] | "unknown";
  };
};

export type RuntimeRiskLevel = "low" | "medium" | "high";

export type RuntimePlanConfidence = "high" | "medium" | "low";

export type RuntimeActionInvocation =
  | {
      actionId: "artifact.generate";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      actionId: "layout.split_two" | "layout.reset";
      input: {
        preset?: "two_column" | "reading" | "focus";
      };
    }
  | {
      actionId: "theme.apply_preset" | "theme.reset";
      input: {
        preset?: "playful" | "default";
        tone?: "cartoon" | "quiet";
      };
    }
  | {
      actionId: "panel.open" | "panel.close" | "panel.toggle";
      input: {
        panel: PanelActionTarget;
      };
    }
  | {
      actionId: "selected_set.import";
      input: {
        source: "selected_document_set";
      };
    }
  | {
      actionId: "settings.update";
      input: {
        target: UpdateSettingCommand["target"];
        value: UpdateSettingCommand["value"];
      };
    }
  | {
      actionId: "organization.open_shared_library";
      input: {
        source: "organization_space";
      };
    }
  | {
      actionId: "workspace.delete_documents";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "workspace.overwrite_documents";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "workspace.batch_update_documents";
      input: {
        scope: "selected_document_set" | "current_workspace";
      };
    }
  | {
      actionId: "cloud.upload_documents";
      input: {
        scope: "selected_document_set" | "current_workspace";
      };
    }
  | {
      actionId: "cloud.sync_workspace";
      input: {
        scope: "current_workspace";
      };
    };

export type SemanticFallbackExplanation = {
  alternatives: string[];
  cannotExecuteBecause: string;
  needs: string[];
  understoodAs: string;
};

export type SemanticActionPlan = {
  actions: RuntimeActionInvocation[];
  clarification?: {
    missing: string[];
    question: string;
  };
  confidence: RuntimePlanConfidence;
  fallback?: SemanticFallbackExplanation;
  intentId:
    | "artifact.generate"
    | "cloud.sync_workspace"
    | "cloud.upload_documents"
    | "layout.change"
    | "theme.apply"
    | "panel.change"
    | "selected_set.import"
    | "settings.update"
    | "organization.open_shared_library"
    | "workspace.batch_update_documents"
    | "workspace.delete_documents"
    | "workspace.overwrite_documents"
    | "unknown";
  planId: string;
  requiredContext: string[];
  requiresConfirmation: boolean;
  riskLevel: RuntimeRiskLevel;
  summary: string;
  unsupportedReason?: string;
};

export type SemanticPlannerContext = {
  contextView?: AgentRuntimeContextView;
  registeredActions: RegisteredActionMetadata[];
};

export type SemanticCommandPlanner = (
  input: AgentRuntimeInput,
  context: SemanticPlannerContext
) => Promise<SemanticActionPlan> | SemanticActionPlan;

export type AgentRuntimeEvent =
  | { plan: SemanticActionPlan; type: "plan_preview" }
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
