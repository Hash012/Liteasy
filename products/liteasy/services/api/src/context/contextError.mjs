export class ContextError extends Error {
  constructor(code, status = 400, currentRevision) {
    super(code);
    this.code = code;
    this.status = status;
    this.currentRevision = currentRevision;
  }
}

export const apiVersion = "liteasy.context-api/v1";
export const idempotencyWindowSeconds = 7 * 24 * 60 * 60;

export function contextErrorBody(error, requestId) {
  const known = error instanceof ContextError || (Number.isInteger(error?.status) && error.status < 500);
  const status = known ? error.status : 503;
  const code = known ? error.code : "context_service_unavailable";
  const messages = {
    context_revision_conflict: "条目已被修改，请读取当前版本后重新编辑。",
    context_operation_conflict: "此操作编号已用于不同内容。",
    context_scope_forbidden: "当前凭据没有此范围的操作权限。",
    context_grant_invalid: "凭据已失效，请重新登录。",
    context_not_found: "条目或回执不存在。",
    context_schema_unsupported: "不支持此契约版本。",
    context_scope_immutable: "普通编辑不能变更条目的归组。"
  };
  return { status, body: { schemaVersion: apiVersion, error: {
    code, message: messages[code] ?? (status >= 500 ? "服务暂时不可用，请使用原操作编号重试。" : "请求无效，请检查输入。"),
    retryable: status >= 500, requestId,
    ...(error?.currentRevision ? { currentRevision: error.currentRevision } : {})
  } } };
}
