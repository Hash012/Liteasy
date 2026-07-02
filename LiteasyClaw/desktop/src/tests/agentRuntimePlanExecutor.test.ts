import { executeSemanticPlan } from "../app/features/agent-runtime/planExecutor";
import type { SemanticActionPlan } from "../app/features/agent-runtime/agentRuntime.types";
import { vi } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";

function createPlan(overrides: Partial<SemanticActionPlan> = {}): SemanticActionPlan {
  return {
    actions: [],
    confidence: "high",
    intentId: "unknown",
    planId: "plan-test",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "测试计划",
    ...overrides
  };
}

test("executes registered low-risk layout actions", async () => {
  const applyLayoutPreset = vi.fn(() => "已切换为双栏布局。");

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "layout.split_two",
          input: {
            preset: "two_column"
          }
        }
      ],
      intentId: "layout.change",
      summary: "切换为双栏布局"
    }),
    {
      applyLayoutPreset
    }
  );

  expect(applyLayoutPreset).toHaveBeenCalledWith({
    preset: "two_column"
  });
  expect(result).toEqual({
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
});

test("executes registered low-risk theme actions", async () => {
  const applyThemePreset = vi.fn(() => "已应用卡通风格。");

  const result = await executeSemanticPlan(
    createPlan({
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
      summary: "应用卡通风格"
    }),
    {
      applyThemePreset
    }
  );

  expect(applyThemePreset).toHaveBeenCalledWith({
    preset: "playful",
    tone: "cartoon"
  });
  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        intentId: "theme.apply",
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

test("executes registered low-risk panel actions", async () => {
  const applyPanelAction = vi.fn(() => "已打开设置面板。");

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "panel.open",
          input: {
            panel: "settings"
          }
        }
      ],
      intentId: "panel.change",
      summary: "打开设置面板"
    }),
    {
      applyPanelAction
    }
  );

  expect(applyPanelAction).toHaveBeenCalledWith({
    operation: "open",
    panel: "settings"
  });
  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        intentId: "panel.change",
        summary: "打开设置面板"
      }),
      type: "plan_preview"
    },
    {
      action: {
        actionId: "panel.open",
        payload: {
          panel: "settings"
        }
      },
      type: "action_request"
    },
    {
      message: "已打开设置面板。",
      type: "assistant_reply"
    }
  ]);
});

test("executes registered selected-set import actions", async () => {
  const importSelectedSet = vi.fn(() => "已将当前选中文献集交给 AI 流程，正在执行解析与索引。");

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "selected_set.import",
          input: {
            source: "selected_document_set"
          }
        }
      ],
      intentId: "selected_set.import",
      requiredContext: ["selected_document_set"],
      summary: "导入当前选中文献集"
    }),
    {
      importSelectedSet
    }
  );

  expect(importSelectedSet).toHaveBeenCalledTimes(1);
  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        intentId: "selected_set.import",
        summary: "导入当前选中文献集"
      }),
      type: "plan_preview"
    },
    {
      action: {
        actionId: "selected_set.import",
        payload: {
          source: "selected_document_set"
        }
      },
      type: "action_request"
    },
    {
      message: "已将当前选中文献集交给 AI 流程，正在执行解析与索引。",
      type: "assistant_reply"
    }
  ]);
});

test("executes registered low-risk settings actions", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "settings.update",
          input: {
            target: "network.recommendation.enabled",
            value: false
          }
        }
      ],
      intentId: "settings.update",
      summary: "关闭联网推荐"
    }),
    {
      settingsStore
    }
  );

  expect(settingsStore.getState()["network.recommendation.enabled"]).toBe(false);
  expect(result).toEqual({
    events: [
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
    ],
    settingsChanged: true
  });
});

test("returns confirmation before registered medium-risk settings actions", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "settings.update",
          input: {
            target: "profile.enabled",
            value: true
          }
        }
      ],
      intentId: "settings.update",
      requiresConfirmation: true,
      riskLevel: "medium",
      summary: "开启用户画像"
    }),
    {
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
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
});

test("uses registered action policy to require confirmation even when a plan omits it", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "settings.update",
          input: {
            target: "profile.enabled",
            value: true
          }
        }
      ],
      intentId: "settings.update",
      requiresConfirmation: false,
      riskLevel: "low",
      summary: "开启用户画像"
    }),
    {
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        intentId: "settings.update",
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
  ]);
});

test("executes registered organization actions", async () => {
  const openOrganizationSharedLibrary = vi.fn(() => "已打开组织共享文献库：AI Reading Lab。");

  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "organization.open_shared_library",
          input: {
            source: "organization_space"
          }
        }
      ],
      intentId: "organization.open_shared_library",
      requiredContext: ["organization"],
      summary: "打开组织共享文献库"
    }),
    {
      openOrganizationSharedLibrary
    }
  );

  expect(openOrganizationSharedLibrary).toHaveBeenCalledTimes(1);
  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        intentId: "organization.open_shared_library",
        summary: "打开组织共享文献库"
      }),
      type: "plan_preview"
    },
    {
      action: {
        actionId: "organization.open_shared_library",
        payload: {
          source: "organization_space"
        }
      },
      type: "action_request"
    },
    {
      message: "已打开组织共享文献库：AI Reading Lab。",
      type: "assistant_reply"
    }
  ]);
});

test("returns a runtime error when a low-risk ui handler is missing", async () => {
  const result = await executeSemanticPlan(
    createPlan({
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
      summary: "应用卡通风格"
    }),
    {}
  );

  expect(result.events).toEqual([
    {
      plan: expect.objectContaining({
        intentId: "theme.apply",
        summary: "应用卡通风格"
      }),
      type: "plan_preview"
    },
    {
      message: "UI 动作执行能力尚未注册。",
      recovery: "请检查 应用卡通风格 的 theme.apply_preset action 是否已连接。",
      type: "runtime_error"
    }
  ]);
});

test("returns clarification events from ambiguous plans", async () => {
  const result = await executeSemanticPlan(
    createPlan({
      clarification: {
        missing: ["intent"],
        question:
          "我理解你可能想让软件处理“ABC”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。"
      },
      confidence: "low",
      summary: "需要澄清命令意图"
    }),
    {}
  );

  expect(result.events).toEqual([
    {
      missing: ["intent"],
      question:
        "我理解你可能想让软件处理“ABC”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。",
      type: "clarification_request"
    }
  ]);
});

test("returns unsupported explanations for understood missing capabilities", async () => {
  const result = await executeSemanticPlan(
    createPlan({
      intentId: "artifact.generate",
      summary: "当前还不能生成对比表，可用模态：思维导图、树状图、PPT",
      unsupportedReason: "对比表产物还没有注册到可执行 artifact action；可以先生成思维导图、树状图或 PPT。"
    }),
    {}
  );

  expect(result.events).toEqual([
    {
      message: "当前还不能生成对比表，可用模态：思维导图、树状图、PPT",
      recovery: "对比表产物还没有注册到可执行 artifact action；可以先生成思维导图、树状图或 PPT。",
      type: "runtime_error"
    }
  ]);
});

test("executes registered artifact plans through the artifact handler", async () => {
  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "tree",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      requiredContext: ["selected_document_set"],
      summary: "生成树状图"
    }),
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
  );

  expect(result).toEqual({
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
