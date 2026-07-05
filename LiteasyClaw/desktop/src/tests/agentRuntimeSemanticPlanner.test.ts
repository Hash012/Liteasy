import { planSemanticCommand } from "../app/features/agent-runtime/semanticPlanner";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

test("plans a semantic mind map artifact command", () => {
  const plan = planSemanticCommand({
    message: "用思维导图解释当前选中文献集",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [
      {
        actionId: "artifact.generate",
        input: {
          artifactType: "mindmap",
          source: "selected_document_set"
        }
      }
    ],
    confidence: "high",
    intentId: "artifact.generate",
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "生成思维导图"
  });
});

test("plans registered artifact modalities from semantic language", () => {
  expect(planSemanticCommand({ message: "生成树状图", mode: "command" }).actions[0]).toEqual({
    actionId: "artifact.generate",
    input: {
      artifactType: "tree",
      source: "selected_document_set"
    }
  });

  expect(planSemanticCommand({ message: "做一份 PPT", mode: "command" }).actions[0]).toEqual({
    actionId: "artifact.generate",
    input: {
      artifactType: "ppt",
      source: "selected_document_set"
    }
  });
});

test("plans comparison-table artifact commands from semantic language", () => {
  const plan = planSemanticCommand({
    message: "把当前论文生成对比表",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [
      {
        actionId: "artifact.generate",
        input: {
          artifactType: "comparison_table",
          source: "selected_document_set"
        }
      }
    ],
    confidence: "high",
    intentId: "artifact.generate",
    requiredContext: ["selected_document_set"],
    summary: "生成对比表"
  });
});

test("plans layout and theme actions from semantic UI instructions", () => {
  expect(planSemanticCommand({ message: "把窗口切分成两个", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "layout.split_two",
        input: {
          preset: "two_column"
        }
      }
    ],
    intentId: "layout.change",
    riskLevel: "low",
    summary: "切换为双栏布局"
  });

  expect(planSemanticCommand({ message: "让 UI 变成卡通风格", mode: "command" })).toMatchObject({
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
    riskLevel: "low",
    summary: "应用卡通风格"
  });
});

test("plans panel and navigation actions from semantic UI instructions", () => {
  expect(planSemanticCommand({ message: "打开设置面板", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "panel.open",
        input: {
          panel: "settings"
        }
      }
    ],
    intentId: "panel.change",
    riskLevel: "low",
    summary: "打开设置面板"
  });

  expect(planSemanticCommand({ message: "关闭左栏", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "panel.close",
        input: {
          panel: "left"
        }
      }
    ],
    intentId: "panel.change",
    riskLevel: "low",
    summary: "关闭左栏"
  });
});

test("plans explicit dock item move commands and refuses empty bottom opening", () => {
  expect(planSemanticCommand({ message: "把 AI 助手放到下栏", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "dock.move_item",
        input: {
          itemId: "assistant",
          targetRegion: "bottom"
        }
      }
    ],
    intentId: "dock.move_item",
    riskLevel: "low",
    summary: "移动Liteasy Chat到下栏"
  });

  expect(planSemanticCommand({ message: "文献库挪到右侧", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "dock.move_item",
        input: {
          itemId: "library",
          targetRegion: "right"
        }
      }
    ],
    intentId: "dock.move_item",
    summary: "移动文献库到右栏"
  });

  expect(planSemanticCommand({ message: "打开下栏", mode: "command" })).toMatchObject({
    actions: [],
    clarification: {
      kind: "missing_context",
      missing: ["dock_item"],
      question: "要把哪个标签页放到下栏？例如：把 AI 助手放到下栏。"
    },
    intentId: "unknown"
  });
});

test("returns ambiguous action candidates for broad organization commands", () => {
  const plan = planSemanticCommand({ message: "打开组织", mode: "command" });

  expect(plan).toMatchObject({
    actions: [],
    clarification: {
      kind: "ambiguous_action",
      missing: ["ambiguous_action"],
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
      ]
    },
    confidence: "medium",
    intentId: "unknown"
  });
});

test("uses pending ambiguous command context to resolve a short follow-up phrase", () => {
  const previousPlan = planSemanticCommand({ message: "打开组织", mode: "command" });
  const plan = planSemanticCommand(
    {
      message: "组织面板",
      mode: "command"
    },
    {
      pendingClarification: {
        clarification: previousPlan.clarification!,
        previousInput: "打开组织"
      },
      registeredActions: getRegisteredActionMetadata()
    }
  );

  expect(plan).toMatchObject({
    actions: [
      {
        actionId: "panel.open",
        input: {
          panel: "organization"
        }
      }
    ],
    confidence: "high",
    intentId: "panel.change",
    summary: "打开组织面板"
  });
});

test("keeps asking when a follow-up phrase still matches multiple pending candidates", () => {
  const previousPlan = planSemanticCommand({ message: "打开组织", mode: "command" });
  const plan = planSemanticCommand(
    {
      message: "组织",
      mode: "command"
    },
    {
      pendingClarification: {
        clarification: previousPlan.clarification!,
        previousInput: "打开组织"
      },
      registeredActions: getRegisteredActionMetadata()
    }
  );

  expect(plan).toMatchObject({
    actions: [],
    clarification: {
      kind: "ambiguous_action"
    },
    intentId: "unknown"
  });
});

test("plans academic archive commands as registered profile actions", () => {
  expect(planSemanticCommand({ message: "打开学术人格里的学术档案", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "profile.open_academic_archive",
        input: {}
      }
    ],
    intentId: "profile.open_academic_archive",
    riskLevel: "low",
    summary: "打开学术档案"
  });
});

test("plans selected document set import actions from semantic language", () => {
  expect(planSemanticCommand({ message: "导入当前选中文献集", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "selected_set.import",
        input: {
          source: "selected_document_set"
        }
      }
    ],
    intentId: "selected_set.import",
    riskLevel: "low",
    summary: "导入当前选中文献集"
  });
});

test("returns clarification for unknown ambiguous command text", () => {
  const plan = planSemanticCommand({
    message: "ABC",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [],
    clarification: {
      kind: "not_command",
      missing: ["not_command"],
      question:
        "我不确定“ABC”是在要求 LiteasyClaw 执行软件动作。你可以切换到问答/名词解释，或明确说要打开、生成、切换、导入、同步、上传、删除还是调整什么。"
    },
    confidence: "low",
    intentId: "unknown"
  });
});

test("returns unsupported action clarification for commands outside the action catalog", () => {
  const plan = planSemanticCommand({
    message: "导出一段视频讲解",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [],
    clarification: {
      kind: "unsupported_action",
      missing: ["unsupported_action"],
      question: "我理解你想导出视频讲解，但当前动作目录还没有可执行的视频导出能力。"
    },
    confidence: "medium",
    intentId: "unknown",
    unsupportedReason: "未注册 video.export 或等价动作。"
  });
});

test("uses runtime context when clarifying ambiguous command text", () => {
  const plan = planSemanticCommand(
    {
      message: "ABC",
      mode: "command"
    },
    {
      contextView: {
        cloud: { connected: true, organizationName: "AI Reading Lab" },
        profile: { enabled: false, requiresConfirmation: true },
        selection: {
          importedCount: 3,
          issues: [],
          locked: true,
          ready: true,
          selectedCount: 3
        },
        workspace: { type: "local_library" }
      },
      registeredActions: getRegisteredActionMetadata()
    }
  );

  expect(plan).toMatchObject({
    actions: [],
    clarification: {
      kind: "not_command",
      missing: ["not_command"],
      question:
        "我不确定“ABC”是在要求 LiteasyClaw 执行软件动作。它也可能是在指当前已锁定的 3 篇选中文献中的术语、缩写或对象。你可以切换到问答/名词解释，或明确说要打开、生成、切换、导入、同步、上传、删除还是调整什么。"
    },
    fallback: {
      alternatives: ["解释 ABC", "生成思维导图", "导入当前选中文献集"],
      cannotExecuteBecause: "当前命令没有明确的软件动作或目标对象。",
      needs: ["明确动作", "明确对象"],
      understoodAs: "可能是在指当前已锁定的 3 篇选中文献中的术语、缩写或对象"
    }
  });
});

test("plans high-risk cloud sync commands as confirmation-only actions", () => {
  const plan = planSemanticCommand({
    message: "同步当前工作区到云端",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [
      {
        actionId: "cloud.sync_workspace",
        input: {
          scope: "current_workspace"
        }
      }
    ],
    intentId: "cloud.sync_workspace",
    requiresConfirmation: true,
    riskLevel: "high",
    summary: "同步当前工作区到云端"
  });
});

test("plans existing settings and organization commands as semantic plans", () => {
  expect(planSemanticCommand({ message: "关闭联网推荐", mode: "command" })).toMatchObject({
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
  });

  expect(planSemanticCommand({ message: "按检索时间排序推荐", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "settings.update",
        input: {
          target: "network.recommendation.sort_mode",
          value: "retrieved_at"
        }
      }
    ],
    intentId: "settings.update",
    summary: "按检索时间排序推荐"
  });

  expect(planSemanticCommand({ message: "按关联度排序推荐", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "settings.update",
        input: {
          target: "network.recommendation.sort_mode",
          value: "relevance"
        }
      }
    ],
    intentId: "settings.update",
    summary: "按关联度排序推荐"
  });

  expect(planSemanticCommand({ message: "打开组织共享文献库", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    ],
    intentId: "organization.open_shared_library",
    summary: "打开组织共享文献库"
  });

  expect(planSemanticCommand({ message: "带我去团队资料区", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    ],
    intentId: "organization.open_shared_library",
    summary: "打开组织共享文献库"
  });

  expect(planSemanticCommand({ message: "开启用户画像", mode: "command" })).toMatchObject({
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
  });
});
