import { runAgentRuntime } from "../app/features/agent-runtime/runtimeOrchestrator";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { vi } from "vitest";

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
        missing: ["intent"],
        question:
          "我理解你可能想让软件处理“同步云端模型策略”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。",
        type: "clarification_request"
      }
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
    }
  ]);
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
      {
        action: {
          actionId: "cloud.sync_workspace",
          payload: {
            scope: "current_workspace"
          }
        },
        summary: "请确认后再执行：同步当前工作区到云端",
        type: "confirmation_request"
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
        question: "请先勾选要分析的文献，再生成思维导图。",
        type: "clarification_request"
      }
    ],
    settingsChanged: false
  });
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
      }
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
      }
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
      }
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
        artifact: {
          artifactType: "mindmap",
          payload: {
            source: "selected_document_set"
          }
        },
        type: "artifact_request"
      },
      {
        message: "已开始思维导图分析。",
        type: "assistant_reply"
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
        recovery: "请检查 生成思维导图 的 artifact action 是否已连接。",
        type: "runtime_error"
      }
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
        missing: ["intent"],
        question:
          "我理解你可能想让软件处理“ABC”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。",
        type: "clarification_request"
      }
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
        artifact: {
          artifactType: "tree",
          payload: {
            source: "selected_document_set"
          }
        },
        type: "artifact_request"
      },
      {
        message: "已开始树状图分析。",
        type: "assistant_reply"
      }
    ],
    settingsChanged: false
  });
});
