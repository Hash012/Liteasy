import type {
  RegisteredActionMetadata
} from "../skills/actionRegistry";
import type {
  RuntimeActionInvocation,
  SemanticActionPlan
} from "./agentRuntime.types";

export type SmoothExecutionPolicy =
  | {
      kind: "immediate";
    }
  | {
      action: RuntimeActionInvocation;
      kind: "background";
      progressEvents: string[];
      taskId: string;
      taskType: RuntimeActionInvocation["actionId"];
    };

export type SmoothPolicyContext = {
  registeredActions: RegisteredActionMetadata[];
};

export type RecoverableActionFailure = {
  message: string;
  recovery: string;
};

const backgroundLatencyMs = 3000;

function getMetadata(
  action: RuntimeActionInvocation,
  context: SmoothPolicyContext
) {
  return context.registeredActions.find((metadata) => metadata.actionId === action.actionId);
}

function shouldBackground(metadata: RegisteredActionMetadata | undefined) {
  return Boolean(
    metadata &&
      (metadata.estimatedLatencyMs >= backgroundLatencyMs ||
        metadata.progressEvents?.includes("task_created"))
  );
}

export function evaluateSmoothExecutionPolicy(
  plan: SemanticActionPlan,
  context: SmoothPolicyContext
): SmoothExecutionPolicy {
  const backgroundAction = plan.actions.find((action) =>
    shouldBackground(getMetadata(action, context))
  );

  if (!backgroundAction) {
    return {
      kind: "immediate"
    };
  }

  const metadata = getMetadata(backgroundAction, context);

  return {
    action: backgroundAction,
    kind: "background",
    progressEvents: metadata?.progressEvents ? [...metadata.progressEvents] : [],
    taskId: `task-${plan.planId}`,
    taskType: backgroundAction.actionId
  };
}

export function createRecoverableActionFailure(
  plan: Pick<SemanticActionPlan, "summary">,
  action: RuntimeActionInvocation,
  message: string
): RecoverableActionFailure {
  return {
    message,
    recovery: `请检查 ${plan.summary} 的 ${action.actionId} action 是否已连接。`
  };
}

export function shouldCreateAssistantFeedbackUi(plan: SemanticActionPlan) {
  return plan.actions.some(
    (action) =>
      action.actionId.startsWith("layout.") ||
      action.actionId.startsWith("theme.") ||
      action.actionId.startsWith("panel.") ||
      action.actionId === "artifact.generate"
  );
}
