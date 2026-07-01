import type { ActionRiskLevel } from "../resources/resourceActionPolicy";
import type { RuntimeSkillPlan } from "./agentRuntime.types";

export type RuntimeConfirmationDecision =
  | {
      requiresConfirmation: false;
      riskLevel: ActionRiskLevel;
    }
  | {
      message: string;
      requiresConfirmation: true;
      riskLevel: ActionRiskLevel;
    };

export function evaluateRuntimeConfirmation(plan: RuntimeSkillPlan): RuntimeConfirmationDecision {
  if (plan.skill.skillId === "settings.adjust" && plan.skill.input.target === "profile.enabled") {
    return {
      message:
        plan.skill.input.value === true
          ? "用户画像会影响个性化采样与后续回答策略，请确认后再开启。"
          : "关闭用户画像会停止个性化采样，请确认后再关闭。",
      requiresConfirmation: true,
      riskLevel: "medium"
    };
  }

  return {
    requiresConfirmation: false,
    riskLevel: "low"
  };
}
