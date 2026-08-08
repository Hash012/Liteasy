import type { RegisteredActionMetadata } from "../skills/actionRegistry";
import { getRuntimeActionPolicy } from "../skills/actionRegistry";
import type {
  AgentRuntimeContextView,
  RuntimeActionInvocation,
  SemanticActionPlan,
  SemanticClarificationCandidate
} from "./agentRuntime.types";

export type PolicyEngineContext = {
  confirmedActionIds?: string[];
  contextView?: AgentRuntimeContextView;
  registeredActions: RegisteredActionMetadata[];
};

export type SemanticPolicyDecision =
  | {
      kind: "allow";
      riskLevel: SemanticActionPlan["riskLevel"];
    }
  | {
      action: RuntimeActionInvocation;
      kind: "confirm";
      riskLevel: SemanticActionPlan["riskLevel"];
      summary: string;
    }
  | {
      candidates?: SemanticClarificationCandidate[];
      clarificationKind?: NonNullable<SemanticActionPlan["clarification"]>["kind"];
      kind: "clarify";
      missing: string[];
      question: string;
    }
  | {
      kind: "deny";
      reason: string;
      recovery?: string;
    };

function getConfirmationSummary(plan: SemanticActionPlan, action: RuntimeActionInvocation) {
  if (action.actionId === "settings.update" && action.input.target === "profile.enabled") {
    return action.input.value === true
      ? "用户画像会影响个性化采样与后续回答策略，请确认后再开启。"
      : "关闭用户画像会停止个性化采样，请确认后再关闭。";
  }

  return `请确认后再执行：${plan.summary}`;
}

function getArtifactClarification(
  plan: SemanticActionPlan,
  context: PolicyEngineContext
): Extract<SemanticPolicyDecision, { kind: "clarify" }> | null {
  const selection = context.contextView?.selection;

  if (!selection || selection.selectedCount === 0) {
    return {
      kind: "clarify",
      missing: ["selected_document_set"],
      question: `请先勾选要分析的文献，再${plan.summary}。`
    };
  }

  if (!selection.locked) {
    return {
      kind: "clarify",
      missing: ["selected_document_set"],
      question: `请先锁定当前选中文献集，再${plan.summary}。`
    };
  }

  if (selection.importedCount < selection.selectedCount) {
    return {
      kind: "clarify",
      missing: ["ingested_documents"],
      question: `请先导入当前选中文献集，再${plan.summary}。`
    };
  }

  return null;
}

function isRegisteredAction(action: RuntimeActionInvocation, context: PolicyEngineContext) {
  return context.registeredActions.some((metadata) => metadata.actionId === action.actionId);
}

function hasHumanConfirmation(action: RuntimeActionInvocation, context: PolicyEngineContext) {
  return context.confirmedActionIds?.includes(action.actionId) ?? false;
}

function findConfirmationAction(plan: SemanticActionPlan, context: PolicyEngineContext) {
  const policyAction = plan.actions.find(
    (action) =>
      getRuntimeActionPolicy(action).requiresConfirmation &&
      !hasHumanConfirmation(action, context)
  );

  if (policyAction) {
    return policyAction;
  }

  if (!plan.requiresConfirmation) {
    return undefined;
  }

  return plan.actions.find((action) => !hasHumanConfirmation(action, context));
}

function getHighestRiskLevel(plan: SemanticActionPlan) {
  if (plan.riskLevel === "high") {
    return "high";
  }

  if (plan.actions.some((action) => getRuntimeActionPolicy(action).riskLevel === "high")) {
    return "high";
  }

  if (
    plan.riskLevel === "medium" ||
    plan.actions.some((action) => getRuntimeActionPolicy(action).riskLevel === "medium")
  ) {
    return "medium";
  }

  return "low";
}

export function evaluateSemanticPlanPolicy(
  plan: SemanticActionPlan,
  context: PolicyEngineContext
): SemanticPolicyDecision {
  if (plan.clarification) {
    return {
      candidates: plan.clarification.candidates,
      clarificationKind: plan.clarification.kind,
      kind: "clarify",
      missing: plan.clarification.missing,
      question: plan.clarification.question
    };
  }

  if (plan.unsupportedReason) {
    return {
      kind: "deny",
      reason: plan.summary,
      recovery: plan.unsupportedReason
    };
  }

  const unknownAction = plan.actions.find((action) => !isRegisteredAction(action, context));
  if (unknownAction) {
    return {
      kind: "deny",
      reason: "语义计划包含未注册动作。",
      recovery: `Unknown action: ${unknownAction.actionId}`
    };
  }

  if (plan.actions.some((action) => action.actionId === "artifact.generate")) {
    const clarification = getArtifactClarification(plan, context);
    if (clarification) {
      return clarification;
    }
  }

  const confirmationAction = findConfirmationAction(plan, context);
  if (confirmationAction) {
    return {
      action: confirmationAction,
      kind: "confirm",
      riskLevel: getRuntimeActionPolicy(confirmationAction).riskLevel,
      summary: getConfirmationSummary(plan, confirmationAction)
    };
  }

  return {
    kind: "allow",
    riskLevel: getHighestRiskLevel(plan)
  };
}
