import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import {
  getRegisteredActionMetadata,
  type RegisteredActionMetadata
} from "../skills/actionRegistry";
import type {
  AgentRuntimeExecutionContext,
  AssistantMode,
  RuntimeActionInvocation,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";
import { executeSemanticPlan } from "./planExecutor";

export { executeConfirmedSemanticPlan } from "./planExecutor";

type DynamicActionExecutionOptions = {
  mode?: AssistantMode;
  traceId?: string;
};

function getPlanId(actionRef: UIDslActionRef, traceId?: string) {
  if (traceId?.startsWith("trace-") && traceId.length > "trace-".length) {
    return traceId.slice("trace-".length);
  }

  return `ui-action-${actionRef.id}`;
}

function getWorkspaceIntentId(
  actionId: UIDslActionRef["actionId"]
): SemanticActionPlan["intentId"] {
  if (actionId === "workspace.delete_documents") {
    return "workspace.delete_documents";
  }

  if (actionId === "workspace.overwrite_documents") {
    return "workspace.overwrite_documents";
  }

  return "workspace.batch_update_documents";
}

function getCloudIntentId(actionId: UIDslActionRef["actionId"]): SemanticActionPlan["intentId"] {
  return actionId === "cloud.sync_workspace"
    ? "cloud.sync_workspace"
    : "cloud.upload_documents";
}

function getArtifactIntentId(actionId: UIDslActionRef["actionId"]): SemanticActionPlan["intentId"] {
  if (actionId === "artifact.generate" || actionId === "artifact.start_analysis") {
    return "artifact.generate";
  }

  return "unknown";
}

function getIntentIdFromCapability(
  actionRef: UIDslActionRef,
  metadata: RegisteredActionMetadata | undefined
): SemanticActionPlan["intentId"] {
  if (!metadata) {
    return "unknown";
  }

  const matchingSemanticFrame = metadata.semantic?.frames.find(
    (frame) => JSON.stringify(frame.input) === JSON.stringify(actionRef.input)
  );
  if (matchingSemanticFrame?.intentId) {
    return matchingSemanticFrame.intentId as SemanticActionPlan["intentId"];
  }

  const familyIntentMap: Partial<
    Record<RegisteredActionMetadata["family"], SemanticActionPlan["intentId"]>
  > = {
    collection: "collection.add",
    layout: "layout.change",
    organization: "organization.open_shared_library",
    panel: "panel.change",
    plugin: "unknown",
    profile: "profile.open_academic_archive",
    recommendation: "recommendation.refresh",
    selection: "selected_set.import",
    settings: "settings.update",
    theme: "theme.apply"
  };

  if (metadata.family === "artifact") {
    return getArtifactIntentId(actionRef.actionId);
  }

  if (metadata.family === "cloud") {
    return getCloudIntentId(actionRef.actionId);
  }

  if (metadata.family === "workspace") {
    return getWorkspaceIntentId(actionRef.actionId);
  }

  return familyIntentMap[metadata.family] ?? "unknown";
}

function canExecuteOutsideCommandMode(actionRef: UIDslActionRef) {
  return actionRef.actionId === "artifact.open_tab" && actionRef.riskLevel === "low";
}

function createModeGateClarificationPlan(
  actionRef: UIDslActionRef,
  options: DynamicActionExecutionOptions = {}
): SemanticActionPlan {
  return {
    actions: [],
    clarification: {
      kind: "command_mode",
      missing: ["command_mode"],
      question: "软件动作需要用 / 开始输入命令。"
    },
    confidence: "low",
    intentId: "unknown",
    planId: getPlanId(actionRef, options.traceId),
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "当前输入不是软件命令"
  };
}

function createSemanticPlanFromActionRef(
  actionRef: UIDslActionRef,
  options: DynamicActionExecutionOptions = {}
): SemanticActionPlan {
  const metadata = getRegisteredActionMetadata().find(
    (registeredAction) => registeredAction.actionId === actionRef.actionId
  );

  return {
    actions: [
      {
        actionId: actionRef.actionId,
        input: actionRef.input
      } as RuntimeActionInvocation
    ],
    confidence: "high",
    intentId: getIntentIdFromCapability(actionRef, metadata),
    planId: getPlanId(actionRef, options.traceId),
    requiredContext: metadata?.requiredContext ?? [],
    requiresConfirmation: metadata?.requiresConfirmation ?? actionRef.riskLevel !== "low",
    riskLevel: metadata?.riskLevel ?? actionRef.riskLevel,
    summary: actionRef.label
  };
}

export async function executeUIDslActionRef(
  actionRef: UIDslActionRef,
  context: AgentRuntimeExecutionContext,
  options: DynamicActionExecutionOptions = {}
): Promise<RuntimeExecutionResult> {
  if (
    options.mode &&
    options.mode !== "command" &&
    !canExecuteOutsideCommandMode(actionRef)
  ) {
    return executeSemanticPlan(
      createModeGateClarificationPlan(actionRef, options),
      context
    );
  }

  return executeSemanticPlan(
    createSemanticPlanFromActionRef(actionRef, options),
    context
  );
}
