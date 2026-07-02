import { createModelSemanticPlanner } from "../app/features/agent-runtime/modelSemanticPlanner";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";

const plannerContext = {
  registeredActions: getRegisteredActionMetadata()
};

test("converts model JSON into a semantic action plan", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [
            {
              actionId: "theme.apply_preset",
              input: {
                preset: "playful",
                tone: "cartoon"
              }
            }
          ],
          confidence: "high",
          intentId: "theme.apply",
          planId: "model-plan-1",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "应用卡通风格"
        }),
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    }),
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
    }
  });

  await expect(
    planner(
      {
        message: "把界面调成像儿童科普书",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [
      {
        actionId: "theme.apply_preset",
        input: {
          preset: "playful",
          tone: "cartoon"
        }
      }
    ],
    intentId: "theme.apply",
    planId: "model-plan-1",
    summary: "应用卡通风格"
  });
});

test("falls back to the deterministic planner when model JSON is invalid", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: "not-json",
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    }),
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
    }
  });

  await expect(
    planner(
      {
        message: "生成这组论文的对比表",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [
      {
        actionId: "artifact.generate",
        input: {
          artifactType: "comparison_table",
          source: "selected_document_set"
        }
      }
    ],
    intentId: "artifact.generate",
    summary: "生成对比表"
  });
});

test("uses the DeepSeek default model when the active provider is deepseek", async () => {
  const settings = createSettingsStore().getState();
  let requestBody: string | undefined;
  const planner = createModelSemanticPlanner({
    modelTransport: async (request) => {
      requestBody = request.body;

      return {
        json: async () => ({
          answer: JSON.stringify({
            actions: [
              {
                actionId: "layout.split_two",
                input: {
                  orientation: "vertical"
                }
              }
            ],
            confidence: "high",
            intentId: "layout.split",
            planId: "model-plan-deepseek",
            requiredContext: [],
            requiresConfirmation: false,
            riskLevel: "low",
            summary: "切分窗口"
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "deepseek"
          }
        }),
        ok: true,
        status: 200
      };
    },
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
      "models.default_provider": "deepseek"
    }
  });

  await planner(
    {
      message: "把窗口切分成两个",
      mode: "command"
    },
    plannerContext
  );

  expect(JSON.parse(requestBody ?? "{}")).toMatchObject({
    model: "deepseek-v4-flash",
    provider: "deepseek"
  });
  expect(JSON.parse(requestBody ?? "{}").prompt).toContain("actions[].input");
  expect(JSON.parse(requestBody ?? "{}").prompt).toContain("confidence 只能是 high、medium、low");
  expect(JSON.parse(requestBody ?? "{}").prompt).toContain("requiredContext 必须是字符串数组");
});

test("normalizes common DeepSeek planner shape drift into the runtime schema", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [
            {
              actionId: "theme.apply_preset",
              parameters: {
                preset: "playful",
                tone: "cartoon"
              }
            }
          ],
          confidence: 0.95,
          intentId: "change_theme",
          planId: "plan_001",
          requiredContext: {},
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "将UI主题切换为卡通风格"
        }),
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "deepseek"
        }
      }),
      ok: true,
      status: 200
    }),
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
      "models.default_provider": "deepseek"
    }
  });

  await expect(
    planner(
      {
        message: "让 UI 变成卡通风格",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [
      {
        actionId: "theme.apply_preset",
        input: {
          preset: "playful",
          tone: "cartoon"
        }
      }
    ],
    confidence: "high",
    intentId: "change_theme",
    requiredContext: []
  });
});

test("normalizes common model action input aliases into executable runtime inputs", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [
            {
              actionId: "theme.apply_preset",
              input: {
                preset: "cartoon"
              }
            },
            {
              actionId: "layout.split_two",
              input: {
                orientation: "vertical"
              }
            }
          ],
          confidence: "high",
          intentId: "ui.adjust",
          planId: "plan-action-aliases",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "调整界面风格并切分窗口"
        }),
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "deepseek"
        }
      }),
      ok: true,
      status: 200
    }),
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
      "models.default_provider": "deepseek"
    }
  });

  await expect(
    planner(
      {
        message: "让 UI 变成卡通风格，并把窗口切分成两个",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [
      {
        actionId: "theme.apply_preset",
        input: {
          preset: "playful",
          tone: "cartoon"
        }
      },
      {
        actionId: "layout.split_two",
        input: {
          preset: "two_column"
        }
      }
    ],
    intentId: "ui.adjust",
    planId: "plan-action-aliases"
  });
});

test("rejects model plans that reference unregistered actions before fallback", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [
            {
              actionId: "system.run_shell",
              input: {
                command: "rm -rf ."
              }
            }
          ],
          confidence: "high",
          intentId: "system.run_shell",
          planId: "bad-plan",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "运行命令"
        }),
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    }),
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
    }
  });

  await expect(
    planner(
      {
        message: "ABC",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [],
    clarification: {
      missing: ["intent"]
    },
    confidence: "low",
    intentId: "unknown"
  });
});
