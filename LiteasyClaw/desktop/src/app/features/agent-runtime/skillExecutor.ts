import { executeSkill } from "../skills/skillRegistry";
import { evaluateRuntimeConfirmation } from "./confirmationPolicy";
import type {
  ActionRequest,
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  RuntimeExecutionResult,
  RuntimeSkillPlan
} from "./agentRuntime.types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getActionRequest(plan: RuntimeSkillPlan): ActionRequest | null {
  if (plan.skill.skillId === "settings.adjust") {
    return {
      actionId: "settings.update",
      payload: {
        target: plan.skill.input.target,
        value: plan.skill.input.value
      }
    };
  }

  if (plan.skill.skillId === "organization.open_shared_library") {
    return {
      actionId: "organization.open_shared_library",
      payload: plan.skill.input
    };
  }

  return null;
}

export async function executeRuntimeSkill(
  plan: RuntimeSkillPlan,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const action = getActionRequest(plan);
  const confirmation = evaluateRuntimeConfirmation(plan);

  if (confirmation.requiresConfirmation) {
    return {
      events: [
        {
          action: action ?? {
            actionId: plan.skill.skillId,
            payload: plan.skill.input
          },
          summary: confirmation.message,
          type: "confirmation_request"
        }
      ],
      settingsChanged: false
    };
  }

  try {
    const result = await executeSkill(plan.skill, context);
    const events: AgentRuntimeEvent[] = [];

    if (action) {
      events.push({
        action,
        type: "action_request"
      });
    }

    events.push({
      message: result.message,
      type: "assistant_reply"
    });

    return {
      events,
      settingsChanged: plan.skill.skillId === "settings.adjust"
    };
  } catch (error) {
    return {
      events: [
        {
          message: getErrorMessage(error),
          recovery: "请检查该能力是否已注册到安全 action。",
          type: "runtime_error"
        }
      ],
      settingsChanged: false
    };
  }
}
