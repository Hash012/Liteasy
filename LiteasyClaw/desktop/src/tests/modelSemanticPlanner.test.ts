import { createModelSemanticPlanner } from "../app/features/agent-runtime/modelSemanticPlanner";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { vi } from "vitest";

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

test("converts model ambiguous-action clarification candidates into a semantic plan", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [],
          clarification: {
            candidates: [
              {
                actionId: "panel.open",
                input: {
                  panel: "organization"
                },
                label: "打开组织面板"
              },
              {
                actionId: "organization.open_shared_library",
                input: {
                  source: "organization_space"
                },
                label: "打开组织共享文献库"
              }
            ],
            kind: "ambiguous_action",
            missing: ["ambiguous_action"],
            question: "你想打开组织面板，还是组织共享文献库？"
          },
          confidence: "medium",
          intentId: "unknown",
          planId: "model-plan-ambiguous-organization",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "需要确认组织相关动作"
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
        message: "打开组织",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [],
    clarification: {
      candidates: [
        {
          actionId: "panel.open",
          input: {
            panel: "organization"
          },
          label: "打开组织面板"
        },
        {
          actionId: "organization.open_shared_library",
          input: {
            source: "organization_space"
          },
          label: "打开组织共享文献库"
        }
      ],
      kind: "ambiguous_action",
      missing: ["ambiguous_action"]
    },
    confidence: "medium",
    intentId: "unknown"
  });
});

test("uses model clarification without executing over deterministic ambiguity", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [
            {
              actionId: "panel.open",
              input: {
                panel: "organization"
              }
            }
          ],
          clarification: {
            candidates: [
              {
                actionId: "panel.open",
                input: {
                  panel: "organization"
                },
                label: "打开组织面板"
              },
              {
                actionId: "organization.open_shared_library",
                input: {
                  source: "organization_space"
                },
                label: "打开组织共享文献库"
              }
            ],
            kind: "ambiguous_action",
            missing: ["ambiguous_action"],
            question: "我需要确认：你是想打开右侧组织面板，还是进入组织共享文献库？"
          },
          confidence: "high",
          intentId: "panel.change",
          planId: "unsafe-clarification-action",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "打开组织面板"
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
        message: "打开组织",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [],
    clarification: {
      candidates: [
        {
          actionId: "panel.open",
          input: {
            panel: "organization"
          },
          label: "打开组织面板"
        },
        {
          actionId: "organization.open_shared_library",
          input: {
            source: "organization_space"
          },
          label: "打开组织共享文献库"
        }
      ],
      kind: "ambiguous_action",
      missing: ["ambiguous_action"],
      question: "我需要确认：你是想打开右侧组织面板，还是进入组织共享文献库？"
    },
    intentId: "unknown"
  });
});

test("falls back when model clarification invents candidates outside the deterministic recovery set", async () => {
  const settings = createSettingsStore().getState();
  const planner = createModelSemanticPlanner({
    modelTransport: async () => ({
      json: async () => ({
        answer: JSON.stringify({
          actions: [],
          clarification: {
            candidates: [
              {
                actionId: "workspace.delete_documents",
                input: {
                  scope: "selected_document_set"
                },
                label: "删除组织文档"
              }
            ],
            kind: "ambiguous_action",
            missing: ["ambiguous_action"],
            question: "你是不是要删除组织里的文档？"
          },
          confidence: "medium",
          intentId: "unknown",
          planId: "bad-clarification-candidate",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "需要澄清"
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
        message: "打开组织",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [],
    clarification: {
      candidates: [
        {
          actionId: "panel.open",
          input: {
            panel: "organization"
          },
          label: "打开组织面板"
        },
        {
          actionId: "organization.open_shared_library",
          input: {
            source: "organization_space"
          },
          label: "打开组织共享文献库"
        }
      ],
      kind: "ambiguous_action",
      question: "“打开组织”可能指打开组织面板，也可能指打开组织共享文献库。请选择要执行的动作。"
    },
    intentId: "unknown"
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

test("retries the structured planner output once before deterministic fallback", async () => {
  const settings = createSettingsStore().getState();
  const requestBodies: string[] = [];
  let callCount = 0;
  const planner = createModelSemanticPlanner({
    modelTransport: async (request) => {
      requestBodies.push(request.body);
      callCount += 1;

      return {
        json: async () => ({
          answer: callCount === 1
            ? "not-json"
            : JSON.stringify({
                actions: [
                  {
                    actionId: "layout.split_two",
                    input: {
                      preset: "focus"
                    }
                  }
                ],
                confidence: "high",
                intentId: "layout.change",
                planId: "model-plan-retry",
                requiredContext: [],
                requiresConfirmation: false,
                riskLevel: "low",
                summary: "切换到专注阅读布局"
              }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
    }
  });

  await expect(
    planner(
      {
        message: "帮我把界面整理成专注阅读布局",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    actions: [
      {
        actionId: "layout.split_two",
        input: {
          preset: "focus"
        }
      }
    ],
    intentId: "layout.change",
    planId: "model-plan-retry"
  });
  expect(requestBodies).toHaveLength(2);
  expect(JSON.parse(requestBodies[1]).prompt).toContain("上一次输出未通过结构化解析");
});

test("keeps deterministic confirmation plans before calling the model planner", async () => {
  const settings = createSettingsStore().getState();
  const modelTransport = vi.fn(async () => ({
    json: async () => ({
      answer: JSON.stringify({
        actions: [
          {
            actionId: "settings.update",
            input: {
              target: "profile.enabled",
              value: true
            }
          }
        ],
        confidence: "high",
        intentId: "settings.update",
        planId: "unsafe-model-plan",
        requiredContext: [],
        requiresConfirmation: false,
        riskLevel: "low",
        summary: "开启用户画像"
      }),
      execution: {
        backend: "dev_cloud",
        mode: "live",
        provider: "openai"
      }
    }),
    ok: true,
    status: 200
  }));
  const planner = createModelSemanticPlanner({
    modelTransport,
    settings: {
      ...settings,
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
    }
  });

  await expect(
    planner(
      {
        message: "开启用户画像",
        mode: "command"
      },
      plannerContext
    )
  ).resolves.toMatchObject({
    intentId: "settings.update",
    planId: expect.stringMatching(/^plan-/),
    requiresConfirmation: true,
    riskLevel: "medium"
  });
  expect(modelTransport).not.toHaveBeenCalled();
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
      missing: ["not_command"]
    },
    confidence: "low",
    intentId: "unknown"
  });
});
