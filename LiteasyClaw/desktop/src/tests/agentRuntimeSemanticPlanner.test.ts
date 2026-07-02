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
      missing: ["intent"],
      question:
        "我理解你可能想让软件处理“ABC”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。"
    },
    confidence: "low",
    intentId: "unknown"
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
      missing: ["intent"],
      question:
        "我理解“ABC”可能是在指当前已锁定的 3 篇选中文献中的术语、缩写或对象，但它还没有对应到可执行动作。请补充要解释、生成、打开、同步、上传、删除或调整的对象；也可以改说“解释 ABC”“生成思维导图”“导入当前选中文献集”。"
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
