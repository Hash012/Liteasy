import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import type { ActionInvocation } from "../skills/actionRegistry";
import type {
  AgentRuntimeExecutionContext,
  AssistantMode,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";
import { createSemanticPlanFromCapabilityInvocation } from "./capabilityToolAdapter";
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
  return createSemanticPlanFromCapabilityInvocation(
    {
      actionId: actionRef.actionId,
      input: actionRef.input
    } as ActionInvocation,
    {
      planId: getPlanId(actionRef, options.traceId),
      summary: actionRef.label
    }
  );
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
    {
      ...context,
      executionSource: "ui_action"
    }
  );
}
