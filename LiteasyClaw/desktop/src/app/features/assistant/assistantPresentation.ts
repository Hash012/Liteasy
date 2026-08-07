import type { AssistantMode, SelectedSetStatus } from "./assistant.types";
import type { AgentApiErrorCode } from "../agent-api/agentApi.types";

const assistantErrorMessages: Record<AgentApiErrorCode, string> = {
  confirmation_not_found: "确认请求已失效，请重新执行该操作。",
  execution_failed: "AI 任务未完成，请稍后重试。",
  idempotency_conflict: "请求状态已经变化，请刷新后重试。",
  invalid_request: "请求内容不符合要求，请调整后重试。",
  run_not_found: "AI 任务已失效，请重新发起。",
  session_closed: "AI 会话已结束，请重新打开对话。",
  session_not_found: "AI 会话已失效，请重新登录或重新打开对话。",
  unsupported_operation: "当前 AI 操作暂不支持。"
};

function isAgentApiErrorCode(value: unknown): value is AgentApiErrorCode {
  return typeof value === "string" && value in assistantErrorMessages;
}

function assistantErrorDetail(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }
  return "";
}

function assistantErrorCode(error: unknown): AgentApiErrorCode | "assistant_service_unavailable" {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    isAgentApiErrorCode(error.code)
  ) return error.code;
  return "assistant_service_unavailable";
}

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

export function getAssistantErrorMessage(
  error: unknown,
  options: { developerDiagnostics?: boolean } = {}
) {
  const code = assistantErrorCode(error);
  const detail = assistantErrorDetail(error);
  const traceId = detail.match(/\btrace_[A-Za-z0-9._:-]+\b/)?.[0];
  const message = code === "assistant_service_unavailable"
    ? "AI 服务暂时不可用，请检查网络后重试。"
    : assistantErrorMessages[code];
  return [
    message,
    `错误编号：${code}`,
    ...(traceId ? [`追踪编号：${traceId}`] : []),
    ...(options.developerDiagnostics && detail ? [`内部信息：${detail}`] : [])
  ].join("\n");
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
