import type {
  AgentRuntimeExecutionContext,
  AgentRuntimeEvent,
  RuntimeActionInvocation,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";
import { executeAction, getRuntimeActionPolicy } from "../skills/actionRegistry";

function createActionEvent(action: RuntimeActionInvocation): AgentRuntimeEvent {
  return {
    action: {
      actionId: action.actionId,
      payload: action.input as Record<string, unknown>
    },
    type: "action_request"
  };
}

function createMissingHandlerError(
  plan: SemanticActionPlan,
  action: RuntimeActionInvocation
): AgentRuntimeEvent {
  return {
    message: "UI 动作执行能力尚未注册。",
    recovery: `请检查 ${plan.summary} 的 ${action.actionId} action 是否已连接。`,
    type: "runtime_error"
  };
}

function getConfirmationSummary(plan: SemanticActionPlan, action: RuntimeActionInvocation) {
  if (action.actionId === "settings.update" && action.input.target === "profile.enabled") {
    return action.input.value === true
      ? "用户画像会影响个性化采样与后续回答策略，请确认后再开启。"
      : "关闭用户画像会停止个性化采样，请确认后再关闭。";
  }

  return `请确认后再执行：${plan.summary}`;
}

function isUiAction(action: RuntimeActionInvocation) {
  return (
    action.actionId.startsWith("layout.") ||
    action.actionId.startsWith("theme.") ||
    action.actionId.startsWith("panel.")
  );
}

async function executeRegisteredAction(
  action: RuntimeActionInvocation,
  context: AgentRuntimeExecutionContext
) {
  return (await executeAction(action, context)).message;
}

function getArtifactClarification(plan: SemanticActionPlan, context: AgentRuntimeExecutionContext) {
  const selection = context.contextView?.selection;

  if (!selection || selection.selectedCount === 0) {
    return {
      missing: ["selected_document_set"],
      question: `请先勾选要分析的文献，再${plan.summary}。`,
      type: "clarification_request" as const
    };
  }

  if (!selection.locked) {
    return {
      missing: ["selected_document_set"],
      question: `请先锁定当前选中文献集，再${plan.summary}。`,
      type: "clarification_request" as const
    };
  }

  if (selection.importedCount < selection.selectedCount) {
    return {
      missing: ["ingested_documents"],
      question: `请先导入当前选中文献集，再${plan.summary}。`,
      type: "clarification_request" as const
    };
  }

  return null;
}

function getArtifactAction(plan: SemanticActionPlan) {
  return plan.actions.find((action) => action.actionId === "artifact.generate");
}

function getConfirmationAction(plan: SemanticActionPlan) {
  const policyAction = plan.actions.find((action) => getRuntimeActionPolicy(action).requiresConfirmation);

  if (policyAction) {
    return policyAction;
  }

  return plan.requiresConfirmation ? plan.actions[0] : undefined;
}

export async function executeSemanticPlan(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  if (plan.clarification) {
    return {
      events: [
        {
          missing: plan.clarification.missing,
          question: plan.clarification.question,
          type: "clarification_request"
        }
      ],
      settingsChanged: false
    };
  }

  if (plan.unsupportedReason) {
    return {
      events: [
        {
          message: plan.summary,
          recovery: plan.unsupportedReason,
          type: "runtime_error"
        }
      ],
      settingsChanged: false
    };
  }

  const confirmationAction = getConfirmationAction(plan);
  if (confirmationAction) {
    return {
      events: [
        {
          plan,
          type: "plan_preview"
        },
        {
          action: confirmationAction
            ? {
                actionId: confirmationAction.actionId,
                payload: confirmationAction.input as Record<string, unknown>
              }
            : {
                actionId: plan.intentId,
                payload: {}
              },
          summary: confirmationAction
            ? getConfirmationSummary(plan, confirmationAction)
            : `请确认后再执行：${plan.summary}`,
          type: "confirmation_request"
        }
      ],
      settingsChanged: false
    };
  }

  const artifactAction = getArtifactAction(plan);
  if (artifactAction) {
    const clarification = getArtifactClarification(plan, context);
    if (clarification) {
      return {
        events: [clarification],
        settingsChanged: false
      };
    }

    if (!context.startArtifactAnalysis) {
      return {
        events: [
          {
            message: "产物执行能力尚未注册。",
            recovery: `请检查 ${plan.summary} 的 artifact action 是否已连接。`,
            type: "runtime_error"
          }
        ],
        settingsChanged: false
      };
    }

    let message: string;
    try {
      message = await executeRegisteredAction(artifactAction, context);
    } catch (error) {
      return {
        events: [
          {
            message: "产物执行能力尚未注册。",
            recovery: `请检查 ${plan.summary} 的 artifact action 是否已连接。`,
            type: "runtime_error"
          }
        ],
        settingsChanged: false
      };
    }

    return {
      events: [
        {
          plan,
          type: "plan_preview"
        },
        {
          artifact: {
            artifactType: artifactAction.input.artifactType,
            payload: {
              source: artifactAction.input.source
            }
          },
          type: "artifact_request"
        },
        {
          message,
          type: "assistant_reply"
        }
      ],
      settingsChanged: false
    };
  }

  const events: AgentRuntimeEvent[] = [
    {
      plan,
      type: "plan_preview"
    }
  ];

  for (const action of plan.actions) {
    let message: string | null | undefined;
    try {
      message = await executeRegisteredAction(action, context);
    } catch (error) {
      if (isUiAction(action)) {
        events.push(createMissingHandlerError(plan, action));
        continue;
      }

      events.push({
        message: error instanceof Error ? error.message : String(error),
        recovery: `请检查 ${plan.summary} 的 ${action.actionId} action 是否已连接。`,
        type: "runtime_error"
      });
      continue;
    }

    if (message === null) {
      events.push(createActionEvent(action));
      continue;
    }

    if (!message) {
      events.push(createMissingHandlerError(plan, action));
      continue;
    }

    events.push(createActionEvent(action));
    events.push({
      message,
      type: "assistant_reply"
    });
  }

  return {
    events,
    settingsChanged: plan.actions.some((action) => action.actionId === "settings.update")
  };
}
