import { runAgentRuntime } from "../app/features/agent-runtime/runtimeOrchestrator";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("returns runtime errors for unsupported commands", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "同步云端模型策略",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        message: "当前命令还没有注册到安全能力表中。",
        type: "runtime_error"
      }
    ],
    settingsChanged: false
  });
});

test("executes recommendation settings through runtime", async () => {
  const settingsStore = createSettingsStore();

  const result = await runAgentRuntime(
    {
      message: "关闭联网推荐",
      mode: "command"
    },
    {
      settingsStore
    }
  );

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

test("returns confirmation for profile sampling before mutation", async () => {
  const settingsStore = createSettingsStore();

  const result = await runAgentRuntime(
    {
      message: "开启用户画像",
      mode: "command"
    },
    {
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(result).toEqual({
    events: [
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
    ],
    settingsChanged: false
  });
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
});

test("returns a clarification request when a mind map command lacks ready selection context", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["selected_document_set"],
        question: "请先勾选并锁定要分析的文献，再生成思维导图。",
        type: "clarification_request"
      }
    ],
    settingsChanged: false
  });
});
