import { executeRuntimeSkill } from "../app/features/agent-runtime/skillExecutor";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { RuntimeSkillPlan } from "../app/features/agent-runtime/agentRuntime.types";

function recommendationPlan(): RuntimeSkillPlan {
  return {
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    }
  };
}

test("executes a direct settings skill and emits assistant reply plus action request events", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeRuntimeSkill(recommendationPlan(), {
    settingsStore
  });

  expect(result.settingsChanged).toBe(true);
  expect(result.events).toEqual([
    {
      action: {
        actionId: "settings.update",
        payload: {
          target: "network.recommendation.enabled",
          value: false
        }
      },
      type: "action_request"
    },
    {
      message: "已更新 联网推荐：false",
      type: "assistant_reply"
    }
  ]);
  expect(settingsStore.getState()["network.recommendation.enabled"]).toBe(false);
});

test("returns confirmation events before executing confirmation-required settings", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeRuntimeSkill(
    {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "profile.enabled",
          value: true
        }
      }
    },
    {
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(result.settingsChanged).toBe(false);
  expect(result.events).toEqual([
    {
      action: {
        actionId: "settings.update",
        payload: {
          target: "profile.enabled",
          value: true
        }
      },
      summary: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
      type: "confirmation_request"
    }
  ]);
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
});

test("turns execution errors into runtime error events", async () => {
  const result = await executeRuntimeSkill(
    {
      intentId: "organization.open_shared_library",
      kind: "skill",
      skill: {
        skillId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    },
    {}
  );

  expect(result.settingsChanged).toBe(false);
  expect(result.events).toEqual([
    {
      message: "organization.open_shared_library requires an organization shared-library handler",
      recovery: "请检查该能力是否已注册到安全 action。",
      type: "runtime_error"
    }
  ]);
});
