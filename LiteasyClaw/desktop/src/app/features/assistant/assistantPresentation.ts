import type { AssistantMode, SelectedSetStatus } from "./assistant.types";

export const modeLauncherItems: Array<{ id: AssistantMode; label: string; summary: string }> = [
  { id: "explain", label: "名词解释", summary: "概念解释" },
  { id: "command", label: "命令", summary: "受控操作" },
  { id: "qa", label: "问答", summary: "原文定位" }
];

export function getModeLabel(mode: AssistantMode) {
  if (mode === "command") {
    return "命令";
  }

  if (mode === "qa") {
    return "问答";
  }

  return "名词解释";
}

export function getModeHint(mode: AssistantMode) {
  if (mode === "command") {
    return "命令模式可输入“打开组织共享文献库”“关闭联网推荐”“开启用户画像”等受控指令。";
  }

  if (mode === "qa") {
    return "问答模式会基于已导入的选中文献集给出带引用回答。";
  }

  return "名词解释模式会基于已导入文献给出概念说明。";
}

export function getSelectedSetReadyMessage(selectedSetStatus: SelectedSetStatus) {
  if (selectedSetStatus.selectedCount === 0) {
    return "请先在左栏勾选文件，形成选中文献集。";
  }

  if (!selectedSetStatus.selectionLocked) {
    return "请先锁定选中文献集，再使用右栏自然语言分支能力。";
  }

  if (selectedSetStatus.importedCount < selectedSetStatus.selectedCount) {
    return "请先将当前选中文献集导入 AI 流程，再进行问答或解释。";
  }

  return null;
}

export function getAssistantErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.length > 0) {
    return `模型服务暂时不可用，请检查当前模型端点配置或稍后重试。\n详细信息：${error.message}`;
  }

  return "模型服务暂时不可用，请检查当前模型端点配置或稍后重试。";
}

export function getAuditVerdictLabel(verdict: "pass" | "review" | "fail") {
  if (verdict === "pass") {
    return "通过";
  }

  if (verdict === "review") {
    return "需复核";
  }

  return "未通过";
}
