import type {
  AgentRuntimeInput,
  SemanticActionPlan,
  SemanticFallbackExplanation,
  SemanticPlannerContext
} from "./agentRuntime.types";

function createPlanId(input: string) {
  return `plan-${input.length}-${input.charCodeAt(0) || 0}`;
}

function includesAny(input: string, phrases: string[]) {
  return phrases.some((phrase) => input.includes(phrase));
}

function isRecommendationDisableCommand(input: string) {
  return (
    includesAny(input, [
      "关闭联网推荐",
      "停用联网推荐",
      "禁用联网推荐",
      "关闭联网文献推荐",
      "停用联网文献推荐",
      "禁用联网文献推荐"
    ]) ||
    (includesAny(input, ["联网推荐", "联网文献推荐"]) && includesAny(input, ["关闭", "停用", "禁用", "不要", "别再"]))
  );
}

function isRecommendationEnableCommand(input: string) {
  return (
    includesAny(input, [
      "开启联网推荐",
      "打开联网推荐",
      "启用联网推荐",
      "开启联网文献推荐",
      "打开联网文献推荐",
      "启用联网文献推荐"
    ]) ||
    (includesAny(input, ["联网推荐", "联网文献推荐"]) && includesAny(input, ["开启", "打开", "启用", "恢复", "重新开启"]))
  );
}

function isOpenOrganizationSharedLibraryCommand(input: string) {
  return input.includes("打开") && input.includes("组织") && input.includes("共享文献库");
}

function isSelectedSetImportCommand(input: string) {
  return (
    includesAny(input, ["导入当前选中文献集", "导入选中文献集", "导入当前论文", "交给 AI 流程", "交给AI流程"]) ||
    (includesAny(input, ["选中文献", "当前文献", "这组论文"]) && includesAny(input, ["导入", "解析", "索引"]))
  );
}

function isWorkspaceCloudSyncCommand(input: string) {
  return (
    includesAny(input, ["同步", "sync"]) &&
    includesAny(input, ["工作区", "当前工作区"]) &&
    includesAny(input, ["云端", "云", "cloud"])
  );
}

function createFallbackQuestion(input: string, fallback: SemanticFallbackExplanation) {
  const alternatives = fallback.alternatives.map((item) => `“${item}”`).join("");

  return `我理解“${input}”${fallback.understoodAs}，但它还没有对应到可执行动作。请补充要解释、生成、打开、同步、上传、删除或调整的对象；也可以改说${alternatives}。`;
}

function createAmbiguousFallback(
  input: string,
  context?: SemanticPlannerContext
): SemanticFallbackExplanation {
  const selection = context?.contextView?.selection;
  const hasReadySelection = Boolean(selection?.ready && selection.selectedCount > 0);

  if (hasReadySelection && selection) {
    return {
      alternatives: ["解释 ABC", "生成思维导图", "导入当前选中文献集"],
      cannotExecuteBecause: "当前命令没有明确的软件动作或目标对象。",
      needs: ["明确动作", "明确对象"],
      understoodAs: `可能是在指当前已锁定的 ${selection.selectedCount} 篇选中文献中的术语、缩写或对象`
    };
  }

  return {
    alternatives: ["打开设置面板", "生成思维导图", "导入当前选中文献集"],
    cannotExecuteBecause: "当前上下文里它还没有对应到可执行对象或动作。",
    needs: ["明确动作", "明确对象"],
    understoodAs: "可能想让软件处理这段文本"
  };
}

function createPanelOpenPlan(
  input: string,
  panel: "library" | "organization" | "profile" | "settings",
  summary: string
): SemanticActionPlan {
  return {
    ...createBasePlan(input),
    actions: [
      {
        actionId: "panel.open",
        input: {
          panel
        }
      }
    ],
    intentId: "panel.change",
    summary
  };
}

function createPanelSidePlan(
  input: string,
  actionId: "panel.close" | "panel.open" | "panel.toggle",
  panel: "bottom" | "left" | "right",
  summary: string
): SemanticActionPlan {
  return {
    ...createBasePlan(input),
    actions: [
      {
        actionId,
        input: {
          panel
        }
      }
    ],
    intentId: "panel.change",
    summary
  };
}

function createBasePlan(input: string): Omit<SemanticActionPlan, "actions" | "intentId" | "summary"> {
  return {
    confidence: "high",
    planId: createPlanId(input),
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  };
}

export function planSemanticCommand(
  input: AgentRuntimeInput,
  context?: SemanticPlannerContext
): SemanticActionPlan {
  const normalized = input.message.trim();
  const base = createBasePlan(normalized);

  if (input.mode !== "command") {
    return {
      ...base,
      actions: [],
      clarification: {
        missing: ["command_mode"],
        question: "当前模式不执行软件动作，请切换到命令模式。"
      },
      confidence: "low",
      intentId: "unknown",
      summary: "当前模式不执行软件动作"
    };
  }

  if (includesAny(normalized, ["对比表", "对比矩阵", "comparison table"])) {
    return {
      ...base,
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
      requiredContext: ["selected_document_set"],
      summary: "生成对比表"
    };
  }

  if (includesAny(normalized, ["树状图", "树图", "tree"])) {
    return {
      ...base,
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
    };
  }

  if (includesAny(normalized, ["PPT", "ppt", "演示文稿", "幻灯片"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "ppt",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      requiredContext: ["selected_document_set"],
      summary: "生成 PPT"
    };
  }

  if (includesAny(normalized, ["思维导图", "mindmap", "脑图"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "mindmap",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      requiredContext: ["selected_document_set"],
      summary: "生成思维导图"
    };
  }

  if (includesAny(normalized, ["窗口切分成两个", "切成两个", "双栏", "两栏"])) {
    return {
      ...base,
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
    };
  }

  if (includesAny(normalized, ["卡通风格", "卡通 UI", "cartoon"])) {
    return {
      ...base,
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
    };
  }

  if (isRecommendationDisableCommand(normalized)) {
    return {
      ...base,
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
    };
  }

  if (isRecommendationEnableCommand(normalized)) {
    return {
      ...base,
      actions: [
        {
          actionId: "settings.update",
          input: {
            target: "network.recommendation.enabled",
            value: true
          }
        }
      ],
      intentId: "settings.update",
      summary: "开启联网推荐"
    };
  }

  if (normalized === "开启用户画像") {
    return {
      ...base,
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
    };
  }

  if (normalized === "关闭用户画像") {
    return {
      ...base,
      actions: [
        {
          actionId: "settings.update",
          input: {
            target: "profile.enabled",
            value: false
          }
        }
      ],
      intentId: "settings.update",
      requiresConfirmation: true,
      riskLevel: "medium",
      summary: "关闭用户画像"
    };
  }

  if (isOpenOrganizationSharedLibraryCommand(normalized)) {
    return {
      ...base,
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
    };
  }

  if (isSelectedSetImportCommand(normalized)) {
    return {
      ...base,
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
    };
  }

  if (isWorkspaceCloudSyncCommand(normalized)) {
    return {
      ...base,
      actions: [
        {
          actionId: "cloud.sync_workspace",
          input: {
            scope: "current_workspace"
          }
        }
      ],
      intentId: "cloud.sync_workspace",
      requiredContext: ["workspace"],
      requiresConfirmation: true,
      riskLevel: "high",
      summary: "同步当前工作区到云端"
    };
  }

  if (includesAny(normalized, ["打开设置", "设置面板", "设置页"])) {
    return createPanelOpenPlan(normalized, "settings", "打开设置面板");
  }

  if (includesAny(normalized, ["打开文献库", "文献库面板", "回到文献库"])) {
    return createPanelOpenPlan(normalized, "library", "打开文献库面板");
  }

  if (includesAny(normalized, ["打开个人中心", "个人中心面板", "打开画像", "个人画像面板"])) {
    return createPanelOpenPlan(normalized, "profile", "打开个人中心");
  }

  if (includesAny(normalized, ["打开组织面板", "打开组织页", "组织面板", "组织页"])) {
    return createPanelOpenPlan(normalized, "organization", "打开组织面板");
  }

  if (includesAny(normalized, ["关闭左栏", "收起左栏", "隐藏左栏"])) {
    return createPanelSidePlan(normalized, "panel.close", "left", "关闭左栏");
  }

  if (includesAny(normalized, ["打开左栏", "展开左栏", "显示左栏"])) {
    return createPanelSidePlan(normalized, "panel.open", "left", "打开左栏");
  }

  if (includesAny(normalized, ["关闭右栏", "收起右栏", "隐藏右栏"])) {
    return createPanelSidePlan(normalized, "panel.close", "right", "关闭右栏");
  }

  if (includesAny(normalized, ["打开右栏", "展开右栏", "显示右栏", "打开 AI 助手", "打开AI助手"])) {
    return createPanelSidePlan(normalized, "panel.open", "right", "打开右栏");
  }

  if (includesAny(normalized, ["关闭下栏", "收起下栏", "隐藏下栏", "关闭产物区"])) {
    return createPanelSidePlan(normalized, "panel.close", "bottom", "关闭下栏");
  }

  if (includesAny(normalized, ["打开下栏", "展开下栏", "显示下栏", "打开产物区"])) {
    return createPanelSidePlan(normalized, "panel.open", "bottom", "打开下栏");
  }

  const fallback = createAmbiguousFallback(normalized, context);
  const question =
    fallback.understoodAs === "可能想让软件处理这段文本"
      ? `我理解你可能想让软件处理“${normalized}”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。`
      : createFallbackQuestion(normalized, fallback);

  return {
    ...base,
    actions: [],
    clarification: {
      missing: ["intent"],
      question
    },
    confidence: "low",
    fallback,
    intentId: "unknown",
    summary: "需要澄清命令意图"
  };
}
