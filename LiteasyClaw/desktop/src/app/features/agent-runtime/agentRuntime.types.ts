import type { AccountSession } from "../account/account.types";
import type { ArtifactType } from "../artifacts/artifact.types";
import type { UIDslDocument } from "../generative-ui/generativeUi.types";
import type { ExecutionJournal } from "../generative-ui/executionJournal";
import type { OrganizationSummary } from "../organization/organization.types";
import type { SelectedDocumentSetSnapshot } from "../selection/selection.types";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import type { GeneratedThemeInput } from "../theme/generatedTheme";
import type {
  ActionContext,
  DockMoveItemId,
  DockMoveTargetRegion,
  PanelActionTarget,
  RegisteredActionMetadata
} from "../skills/actionRegistry";
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

export type AssistantMode = "explain" | "command" | "qa";

export type AgentRuntimeInput = {
  message: string;
  mode: AssistantMode;
};

export type AgentRuntimeExecutionContext = ActionContext & {
  clarifySemanticPlan?: SemanticPlanClarifier;
  contextView?: AgentRuntimeContextView;
  generateUIDsl?: (input: {
    plan: SemanticActionPlan;
    statusText: string;
  }) => Promise<UIDslDocument> | UIDslDocument;
  journal?: ExecutionJournal;
  pendingClarification?: PendingCommandClarification;
  profileUnlocked?: boolean;
  runtimeInput?: AgentRuntimeInput;
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
      actionId: "layout.set_ratio";
      input: {
        center?: number;
        left?: number;
        right?: number;
      };
    }
  | {
      actionId: "pane.focus";
      input: {
        pane: "bottom" | "center" | "left" | "right";
      };
    }
  | {
      actionId: "dock.move_item";
      input: {
        itemId: DockMoveItemId;
        targetRegion: DockMoveTargetRegion;
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
      actionId: "theme.apply_generated";
      input: GeneratedThemeInput;
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
      actionId: "artifact.open_tab";
      input: {
        artifactId?: string;
        artifactType?: ArtifactType;
      };
    }
  | {
      actionId: "profile.open_academic_archive";
      input: Record<string, never>;
    }
  | {
      actionId: "recommendation.refresh";
      input: {
        scope: "current_workspace" | "selected_document_set";
      };
    }
  | {
      actionId: "collection.add";
      input: {
        scope: "selected_document_set";
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

export type SemanticClarificationCandidate = {
  actionId: RuntimeActionInvocation["actionId"];
  input: Record<string, unknown>;
  label: string;
};

export type SemanticActionPlan = {
  actions: RuntimeActionInvocation[];
  clarification?: {
    candidates?: SemanticClarificationCandidate[];
    kind?: "ambiguous_action" | "not_command" | "unsupported_action" | "missing_context" | "command_mode";
    missing: string[];
    question: string;
  };
  confidence: RuntimePlanConfidence;
  fallback?: SemanticFallbackExplanation;
  intentId:
    | "artifact.generate"
    | "cloud.sync_workspace"
    | "cloud.upload_documents"
    | "dock.move_item"
    | "layout.change"
    | "pane.focus"
    | "theme.apply"
    | "panel.change"
    | "profile.open_academic_archive"
    | "selected_set.import"
    | "recommendation.refresh"
    | "collection.add"
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

export type PendingCommandClarification = {
  clarification: NonNullable<SemanticActionPlan["clarification"]>;
  previousInput: string;
};

export type SemanticPlannerContext = {
  contextView?: AgentRuntimeContextView;
  pendingClarification?: PendingCommandClarification;
  registeredActions: RegisteredActionMetadata[];
};

export type SemanticCommandPlanner = (
  input: AgentRuntimeInput,
  context: SemanticPlannerContext
) => Promise<SemanticActionPlan> | SemanticActionPlan;

export type SemanticPlanClarifierInput = {
  context: SemanticPlannerContext;
  input: AgentRuntimeInput;
  plan: SemanticActionPlan;
};

export type SemanticPlanClarifier = (
  input: SemanticPlanClarifierInput
) => Promise<SemanticActionPlan> | SemanticActionPlan;

export type HumanConfirmationRequest = {
  action: ActionRequest;
  confirmationId: string;
  plan: SemanticActionPlan;
  summary: string;
  traceId: string;
  type: "confirmation_request";
};

export type AgentRuntimeEvent =
  | { plan: SemanticActionPlan; type: "plan_preview" }
  | { planId: string; summary: string; traceId: string; type: "progress_started" }
  | { document: UIDslDocument; type: "ui_dsl_ready" }
  | { message: string; type: "assistant_reply" }
  | {
      candidates?: SemanticClarificationCandidate[];
      kind?: NonNullable<SemanticActionPlan["clarification"]>["kind"];
      missing: string[];
      question: string;
      type: "clarification_request";
    }
  | HumanConfirmationRequest
  | { action: ActionRequest; summary: string; type: "confirmation_request" }
  | { action: ActionRequest; type: "action_request" }
  | { action: ActionRequest; message: string; recovery?: string; type: "action_failed" }
  | { task: TaskRequest; type: "task_request" }
  | { task: TaskRequest & { taskId: string }; type: "task_created" }
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
