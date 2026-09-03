import {
  getRegisteredActionMetadata,
  getRuntimeActionPolicy,
  type ActionInvocation,
  type JsonSchema,
  type RegisteredActionMetadata
} from "../skills/actionRegistry";
import type {
  AgentRuntimeExecutionContext,
  RuntimeActionInvocation,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";
import { executeSemanticPlan } from "./planExecutor";

export const MANAGER_CAPABILITY_TOOL_PREFIX = "liteasy__";

export type ManagerCapabilityToolDefinition = {
  actionId: ActionInvocation["actionId"];
  deferLoading: true;
  description: string;
  name: string;
  outputSchema: JsonSchema;
  parameters: JsonSchema;
  policy: {
    estimatedCost: RegisteredActionMetadata["estimatedCost"];
    estimatedLatencyMs: number;
    failureRecovery: string;
    requiredContext: string[];
    requiresConfirmation: boolean;
    reversible: boolean;
    riskLevel: RegisteredActionMetadata["riskLevel"];
  };
  strict: false;
};

export type ManagerCapabilityToolInvocation = {
  actionId: ActionInvocation["actionId"];
  arguments: Record<string, unknown>;
  toolCallId: string;
};

function normalizeToolNameSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function getManagerCapabilityToolName(actionId: ActionInvocation["actionId"]) {
  const name = `${MANAGER_CAPABILITY_TOOL_PREFIX}${actionId
    .split(".")
    .map(normalizeToolNameSegment)
    .join("__")}`;
  if (name.length > 64) {
    throw new Error(`Capability tool name exceeds 64 characters: ${actionId}`);
  }
  return name;
}

function describeCapability(metadata: RegisteredActionMetadata) {
  const context = metadata.requiredContext.length > 0
    ? `需要上下文：${metadata.requiredContext.join("、")}。`
    : "无需额外工作区上下文。";
  const confirmation = metadata.requiresConfirmation
    ? "调用会进入 Liteasy 用户确认流程。"
    : "调用仍会经过 Liteasy policy engine。";
  return `${metadata.label}。${context}${confirmation}`;
}

export function createManagerCapabilityToolCatalog(
  registeredActions = getRegisteredActionMetadata()
): ManagerCapabilityToolDefinition[] {
  return registeredActions.map((metadata) => ({
    actionId: metadata.actionId,
    deferLoading: true,
    description: describeCapability(metadata),
    name: getManagerCapabilityToolName(metadata.actionId),
    outputSchema: metadata.outputSchema,
    parameters: metadata.inputSchema,
    policy: {
      estimatedCost: metadata.estimatedCost,
      estimatedLatencyMs: metadata.estimatedLatencyMs,
      failureRecovery: metadata.failureRecovery,
      requiredContext: [...metadata.requiredContext],
      requiresConfirmation: metadata.requiresConfirmation,
      reversible: metadata.reversible,
      riskLevel: metadata.riskLevel
    },
    // Registry schemas allow optional properties. The SDK receives these as
    // non-strict schemas; Liteasy still performs authoritative validation before execution.
    strict: false
  }));
}

function getWorkspaceIntentId(
  actionId: ActionInvocation["actionId"]
): SemanticActionPlan["intentId"] {
  if (actionId === "workspace.delete_documents") {
    return "workspace.delete_documents";
  }
  if (actionId === "workspace.overwrite_documents") {
    return "workspace.overwrite_documents";
  }
  return "workspace.batch_update_documents";
}

function getCloudIntentId(
  actionId: ActionInvocation["actionId"]
): SemanticActionPlan["intentId"] {
  return actionId === "cloud.sync_workspace"
    ? "cloud.sync_workspace"
    : "cloud.upload_documents";
}

function getArtifactIntentId(
  actionId: ActionInvocation["actionId"]
): SemanticActionPlan["intentId"] {
  if (actionId === "artifact.generate" || actionId === "artifact.start_analysis") {
    return "artifact.generate";
  }
  return "unknown";
}

function getIntentIdFromCapability(
  invocation: ActionInvocation,
  metadata: RegisteredActionMetadata
): SemanticActionPlan["intentId"] {
  const matchingSemanticFrame = metadata.semantic?.frames.find(
    (frame) => JSON.stringify(frame.input) === JSON.stringify(invocation.input)
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
    plugin: "plugin.install_build",
    profile: "profile.open_academic_archive",
    recommendation: "recommendation.refresh",
    selection: "selected_set.import",
    settings: "settings.update",
    theme: "theme.apply",
    workflow: "workflow.install_draft"
  };

  if (metadata.family === "artifact") {
    return getArtifactIntentId(invocation.actionId);
  }
  if (metadata.family === "cloud") {
    return getCloudIntentId(invocation.actionId);
  }
  if (metadata.family === "workspace") {
    return getWorkspaceIntentId(invocation.actionId);
  }
  return familyIntentMap[metadata.family] ?? "unknown";
}

function getPlanId(toolCallId: string) {
  const normalizedCallId = toolCallId.trim().replace(/[^A-Za-z0-9_-]/g, "-");
  return `manager-tool-${normalizedCallId || "call"}`;
}

export function createSemanticPlanFromCapabilityInvocation(
  invocation: ActionInvocation,
  options: { planId?: string; summary?: string; toolCallId?: string }
): SemanticActionPlan {
  const metadata = getRegisteredActionMetadata().find(
    (registeredAction) => registeredAction.actionId === invocation.actionId
  );
  if (!metadata) {
    throw new Error(`Unknown manager capability: ${invocation.actionId}`);
  }
  const runtimePolicy = getRuntimeActionPolicy(invocation);

  return {
    actions: [invocation as RuntimeActionInvocation],
    confidence: "high",
    intentId: getIntentIdFromCapability(invocation, metadata),
    planId: options.planId ?? getPlanId(options.toolCallId ?? "call"),
    requiredContext: [...runtimePolicy.requiredContext],
    requiresConfirmation: runtimePolicy.requiresConfirmation,
    riskLevel: runtimePolicy.riskLevel,
    summary: options.summary?.trim() || metadata.label
  };
}

export async function executeManagerCapabilityTool(
  invocation: ManagerCapabilityToolInvocation,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const summary = invocation.actionId === "plugin.install_build" &&
    typeof invocation.arguments.buildId === "string" &&
    context.describePluginBuildForApproval
    ? await context.describePluginBuildForApproval(invocation.arguments.buildId)
    : undefined;
  const plan = createSemanticPlanFromCapabilityInvocation(
    {
      actionId: invocation.actionId,
      input: invocation.arguments
    } as ActionInvocation,
    {
      summary,
      toolCallId: invocation.toolCallId
    }
  );

  return executeSemanticPlan(plan, {
    ...context,
    executionSource: "manager_tool"
  });
}
