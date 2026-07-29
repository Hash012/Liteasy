import { runAgentRuntime } from "../app/features/agent-runtime/runtimeOrchestrator";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { vi } from "vitest";

function expectFallbackUi(reason: "clarify" | "deny" | "runtime_error" = "clarify") {
  return {
    document: expect.objectContaining({
      audit: expect.objectContaining({
        generatedBy: "rule",
        traceId: expect.any(String)
      }),
      dataSources: expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            reason
          }),
          sourceId: "runtime.context_view"
        })
      ]),
      id: expect.stringMatching(new RegExp(`^fallback-.+-${reason}$`)),
      root: expect.objectContaining({
        children: expect.arrayContaining([
          expect.objectContaining({
            component: "StatusBanner"
          })
        ])
      }),
      surface: "assistant"
    }),
    type: "ui_dsl_ready"
  };
}

test("returns clarifications for unsupported commands", async () => {
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
        kind: "unsupported_action",
        missing: ["unsupported_action"],
        question:
          "我理解你可能想让软件处理“同步云端模型策略”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("can execute a plan returned by an injected semantic planner", async () => {
  const applyThemePreset = vi.fn(() => "已应用卡通风格。");
  const semanticPlanner = vi.fn(() => ({
    actions: [
      {
        actionId: "theme.apply_preset" as const,
        input: {
          preset: "playful" as const,
          tone: "cartoon" as const
        }
      }
    ],
    confidence: "high" as const,
    intentId: "theme.apply" as const,
    planId: "ai-plan-1",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low" as const,
    summary: "应用卡通风格"
  }));

  const result = await runAgentRuntime(
    {
      message: "把界面画风改得像儿童科普书",
      mode: "command"
    },
    {
      applyThemePreset,
      semanticPlanner
    }
  );

  expect(semanticPlanner).toHaveBeenCalledWith(
    {
      message: "把界面画风改得像儿童科普书",
      mode: "command"
    },
    expect.objectContaining({
      registeredActions: expect.arrayContaining([
        expect.objectContaining({
          actionId: "theme.apply_preset"
        })
      ])
    })
  );
  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        planId: "ai-plan-1",
        summary: "应用卡通风格"
      }),
      type: "plan_preview"
    },
    {
      action: {
        actionId: "theme.apply_preset",
        payload: {
          preset: "playful",
          tone: "cartoon"
        }
      },
      type: "action_request"
    },
    {
      message: "已应用卡通风格。",
      type: "assistant_reply"
    },
    {
      document: expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionId: "theme.reset",
            label: "恢复默认"
          })
        ],
        intentPlanId: "ai-plan-1",
        surface: "assistant"
      }),
      type: "ui_dsl_ready"
    }
  ]);
});

test("rejects injected semantic plans that fail the action contract validator", async () => {
  const result = await runAgentRuntime(
    {
      message: "运行系统命令",
      mode: "command"
    },
    {
      semanticPlanner: () => ({
        actions: [
          {
            actionId: "system.run_shell",
            input: {
              command: "rm -rf ."
            }
          } as never
        ],
        confidence: "high",
        intentId: "unknown",
        planId: "unsafe-plan",
        requiredContext: [],
        requiresConfirmation: false,
        riskLevel: "low",
        summary: "运行系统命令"
      })
    }
  );

  expect(result).toEqual({
    events: [
      {
        message: "语义计划未通过动作契约校验。",
        recovery: "Unknown action: system.run_shell",
        type: "runtime_error"
      },
      expectFallbackUi("runtime_error")
    ],
    settingsChanged: false
  });
});

test("does not fall back to legacy command routing after a semantic clarification plan", async () => {
  const result = await runAgentRuntime(
    {
      message: "关闭联网推荐",
      mode: "command"
    },
    {
      semanticPlanner: () => ({
        actions: [],
        clarification: {
          kind: "unsupported_action",
          missing: ["unsupported_action"],
          question: "语义规划器没有给出可执行动作。"
        },
        confidence: "low",
        intentId: "unknown",
        planId: "semantic-clarify-only",
        requiredContext: [],
        requiresConfirmation: false,
        riskLevel: "low",
        summary: "无法映射为动作"
      })
    }
  );

  expect(result).toEqual({
    events: [
      {
        kind: "unsupported_action",
        missing: ["unsupported_action"],
        question: "语义规划器没有给出可执行动作。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("returns confirmation for high-risk semantic runtime actions before execution", async () => {
  const result = await runAgentRuntime(
    {
      message: "同步当前工作区到云端",
      mode: "command"
    },
    {}
  );

  expect(result).toEqual({
    events: [
      {
        plan: expect.objectContaining({
          intentId: "cloud.sync_workspace",
          riskLevel: "high",
          summary: "同步当前工作区到云端"
        }),
        type: "plan_preview"
      },
      expect.objectContaining({
        action: {
          actionId: "cloud.sync_workspace",
          payload: {
            scope: "current_workspace"
          }
        },
        summary: "请确认后再执行：同步当前工作区到云端",
        type: "confirmation_request"
      })
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
      plan: expect.objectContaining({
        intentId: "settings.update",
        summary: "关闭联网推荐"
      }),
      type: "plan_preview"
    },
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
        plan: expect.objectContaining({
          intentId: "settings.update",
          riskLevel: "medium",
          summary: "开启用户画像"
        }),
        type: "plan_preview"
      },
      expect.objectContaining({
        action: {
          actionId: "settings.update",
          payload: {
            target: "profile.enabled",
            value: true
          }
        },
        summary: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
        type: "confirmation_request"
      })
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
        question: "请先勾选要分析的文献，再生成思维导图。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("refines policy clarification before rendering missing-context recovery", async () => {
  const clarifySemanticPlan = vi.fn(({ plan }) => ({
    ...plan,
    clarification: {
      ...plan.clarification!,
      question: "我可以生成思维导图，但需要你先选择并锁定要分析的文献。"
    }
  }));

  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        clarifySemanticPlan
      }
    )
  ).resolves.toEqual({
    events: [
      {
        kind: "missing_context",
        missing: ["selected_document_set"],
        question: "我可以生成思维导图，但需要你先选择并锁定要分析的文献。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
  expect(clarifySemanticPlan).toHaveBeenCalledWith(
    expect.objectContaining({
      input: {
        message: "生成思维导图",
        mode: "command"
      },
      plan: expect.objectContaining({
        clarification: expect.objectContaining({
          kind: "missing_context",
          missing: ["selected_document_set"]
        })
      })
    })
  );
});

test("asks the user to lock the selected set before generating a mind map", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 1,
            issues: ["selection_unlocked"],
            locked: false,
            ready: false,
            selectedCount: 1
          },
          workspace: { type: "local_library" }
        },
        startArtifactAnalysis: () => "should not run"
      }
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["selected_document_set"],
        question: "请先锁定当前选中文献集，再生成思维导图。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("asks the user to import selected papers before generating a mind map", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 1,
            issues: ["documents_not_imported"],
            locked: true,
            ready: false,
            selectedCount: 2
          },
          workspace: { type: "local_library" }
        },
        startArtifactAnalysis: () => "should not run"
      }
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["ingested_documents"],
        question: "请先导入当前选中文献集，再生成思维导图。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("derives mind map import readiness from selection counts even when issues are stale", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 1,
            issues: [],
            locked: true,
            ready: true,
            selectedCount: 2
          },
          workspace: { type: "local_library" }
        },
        startArtifactAnalysis: () => "should not run"
      }
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["ingested_documents"],
        question: "请先导入当前选中文献集，再生成思维导图。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("runs a mind map artifact request when context is ready", async () => {
  const result = await runAgentRuntime(
    {
      message: "生成思维导图",
      mode: "command"
    },
    {
      contextView: {
        cloud: { connected: true },
        profile: { enabled: false, requiresConfirmation: true },
        selection: {
          importedCount: 2,
          issues: [],
          locked: true,
          ready: true,
          selectedCount: 2
        },
        workspace: { type: "local_library" }
      },
      startArtifactAnalysis: () => "已开始思维导图分析。"
    }
  );

  expect(result).toEqual({
    events: [
      {
        plan: expect.objectContaining({
          intentId: "artifact.generate",
          summary: "生成思维导图"
        }),
        type: "plan_preview"
      },
      {
        planId: expect.any(String),
        summary: "生成思维导图",
        traceId: expect.any(String),
        type: "progress_started"
      },
      {
        artifact: {
          artifactType: "mindmap",
          payload: {
            source: "selected_document_set"
          }
        },
        type: "artifact_request"
      },
      {
        task: {
          payload: {
            artifactType: "mindmap",
            source: "selected_document_set"
          },
          taskId: expect.any(String),
          taskType: "artifact.generate"
        },
        type: "task_created"
      },
      {
        message: "已开始思维导图分析。",
        type: "assistant_reply"
      },
      {
        document: expect.objectContaining({
          intentPlanId: expect.any(String),
          root: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({
                component: "ArtifactLauncher",
                props: expect.objectContaining({
                  artifactType: "mindmap"
                })
              })
            ])
          }),
          surface: "assistant"
        }),
        type: "ui_dsl_ready"
      }
    ],
    settingsChanged: false
  });
});

test("returns a runtime error when a ready mind map handler is not registered", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 2,
            issues: [],
            locked: true,
            ready: true,
            selectedCount: 2
          },
          workspace: { type: "local_library" }
        }
      }
    )
  ).resolves.toEqual({
    events: [
      {
        message: "产物执行能力尚未注册。",
        recovery: "请检查 生成思维导图 的 artifact.generate action 是否已连接。",
        type: "runtime_error"
      },
      expectFallbackUi("runtime_error")
    ],
    settingsChanged: false
  });
});

test("routes semantic layout instructions through command runtime plans", async () => {
  const applyLayoutPreset = vi.fn(() => "已切换为双栏布局。");

  await expect(
    runAgentRuntime(
      {
        message: "把窗口切分成两个",
        mode: "command"
      },
      {
        applyLayoutPreset
      }
    )
  ).resolves.toEqual({
    events: [
      {
        plan: expect.objectContaining({
          intentId: "layout.change",
          summary: "切换为双栏布局"
        }),
        type: "plan_preview"
      },
      {
        action: {
          actionId: "layout.split_two",
          payload: {
            preset: "two_column"
          }
        },
        type: "action_request"
      },
      {
        message: "已切换为双栏布局。",
        type: "assistant_reply"
      },
      {
        document: expect.objectContaining({
          actions: [
            expect.objectContaining({
              actionId: "layout.reset",
              label: "恢复默认布局"
            })
          ],
          intentPlanId: expect.any(String),
          surface: "assistant"
        }),
        type: "ui_dsl_ready"
      }
    ],
    settingsChanged: false
  });
  expect(applyLayoutPreset).toHaveBeenCalledWith({
    preset: "two_column"
  });
});

test("asks for clarification instead of returning a generic registry error for unknown commands", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "ABC",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        kind: "not_command",
        missing: ["not_command"],
        question:
          "我不确定“ABC”是在要求 LiteasyClaw 执行软件动作。你可以切换到问答/名词解释，或明确说要打开、生成、切换、导入、同步、上传、删除还是调整什么。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("returns unsupported-action clarification when command semantics are outside the action catalog", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "导出一段视频讲解",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        kind: "unsupported_action",
        missing: ["unsupported_action"],
        question: "我理解你想导出视频讲解，但当前动作目录还没有可执行的视频导出能力。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("returns ambiguous-action candidates when command semantics match multiple registered actions", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "打开组织",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
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
        question: "“打开组织”可能指打开组织面板，也可能指打开组织共享文献库。请选择要执行的动作。",
        type: "clarification_request"
      },
      expectFallbackUi()
    ],
    settingsChanged: false
  });
});

test("executes semantic tree artifact commands through the runtime", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成树状图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 2,
            issues: [],
            locked: true,
            ready: true,
            selectedCount: 2
          },
          workspace: { type: "local_library" }
        },
        startArtifactAnalysis: () => "已开始树状图分析。"
      }
    )
  ).resolves.toEqual({
    events: [
      {
        plan: expect.objectContaining({
          intentId: "artifact.generate",
          summary: "生成树状图"
        }),
        type: "plan_preview"
      },
      {
        planId: expect.any(String),
        summary: "生成树状图",
        traceId: expect.any(String),
        type: "progress_started"
      },
      {
        artifact: {
          artifactType: "tree",
          payload: {
            source: "selected_document_set"
          }
        },
        type: "artifact_request"
      },
      {
        task: {
          payload: {
            artifactType: "tree",
            source: "selected_document_set"
          },
          taskId: expect.any(String),
          taskType: "artifact.generate"
        },
        type: "task_created"
      },
      {
        message: "已开始树状图分析。",
        type: "assistant_reply"
      },
      {
        document: expect.objectContaining({
          root: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({
                component: "ArtifactLauncher",
                props: expect.objectContaining({
                  artifactType: "tree"
                })
              })
            ])
          }),
          surface: "assistant"
        }),
        type: "ui_dsl_ready"
      }
    ],
    settingsChanged: false
  });
});
