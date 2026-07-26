import type { AssistantMode, SelectedSetStatus } from "./assistant.types";

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
    return "输入 / 开始软件命令；普通输入会结合 PDF 选区或当前文献上下文回答。";
  }

  if (mode === "qa") {
    return "普通输入会结合 PDF 选区或当前文献上下文回答。";
  }

  return "输入要解释的概念，助手会结合当前论文上下文给出简明说明。";
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
