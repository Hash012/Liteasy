import { evaluateRuntimeConfirmation } from "../app/features/agent-runtime/confirmationPolicy";
import type { RuntimeSkillPlan } from "../app/features/agent-runtime/agentRuntime.types";

function settingsPlan(
  target: "network.recommendation.enabled" | "network.recommendation.sort_mode" | "profile.enabled",
  value: boolean | "relevance" | "retrieved_at"
): RuntimeSkillPlan {
  return {
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target,
        value
      }
    }
  };
}

test("allows low-risk recommendation enabled settings to execute directly", () => {
  expect(evaluateRuntimeConfirmation(settingsPlan("network.recommendation.enabled", false))).toEqual({
    requiresConfirmation: false,
    riskLevel: "low"
  });
});

test("allows recommendation sort mode settings to execute directly", () => {
  expect(evaluateRuntimeConfirmation(settingsPlan("network.recommendation.sort_mode", "retrieved_at"))).toEqual({
    requiresConfirmation: false,
    riskLevel: "low"
  });
});

test("requires confirmation for profile sampling settings", () => {
  expect(evaluateRuntimeConfirmation(settingsPlan("profile.enabled", true))).toEqual({
    message: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
    requiresConfirmation: true,
    riskLevel: "medium"
  });
});

test("allows non-settings skills to execute directly in this phase", () => {
  expect(
    evaluateRuntimeConfirmation({
      intentId: "organization.open_shared_library",
      kind: "skill",
      skill: {
        skillId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    })
  ).toEqual({
    requiresConfirmation: false,
    riskLevel: "low"
  });
});
