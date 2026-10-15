import { redactDiagnostic } from "../context/objectContext";

export function presentAssistantHistoryError(operation: "读取" | "保存" | "核对", error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const summary = code === "object_forbidden" ? "账号或访问权限已变化，请重新打开对话。" : code === "revision_conflict"
    ? "这段对话已在其他窗口修改。请重新打开后再保存，当前内容仍保留。"
    : `对话${operation}失败，请重试。已有内容仍保留。`;
  return { summary, technical: redactDiagnostic(error instanceof Error ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}` : String(error)) };
}
