import type {
  ArtifactFailureCode,
  ArtifactTaskFailure,
  ArtifactTaskStage
} from "./artifact.types";

export type { ArtifactFailureCode } from "./artifact.types";

const publicMessages: Record<ArtifactFailureCode, string> = {
  artifact_generation_failed: "生成任务未完成，请稍后重试。",
  artifact_verification_failed: "生成结果未通过证据校验，请调整资料或稍后重试。",
  document_processing_failed: "PDF 处理未完成，请确认文件可用后重新导入。",
  external_retrieval_failed: "外部文献检索暂时不可用，请稍后重试。",
  model_authentication_failed: "模型服务授权已失效，请重新登录后重试。",
  model_rate_limited: "模型服务当前请求较多，请稍后重试。",
  model_route_unavailable: "模型服务暂不支持该请求，请稍后重试。",
  service_unavailable: "相关服务暂时不可用，请检查网络后重试。"
};

export function resolveArtifactFailureCode(
  message: string,
  failedStage: ArtifactTaskStage
): ArtifactFailureCode {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("审计未通过") ||
    normalized.includes("verification failed") ||
    normalized.includes("artifact workflow")
  ) return "artifact_verification_failed";
  if (
    failedStage === "waiting_for_import" ||
    failedStage === "thin_reading_parsing_document" ||
    normalized.includes("文本索引")
  ) return "document_processing_failed";
  if (
    failedStage === "thin_reading_retrieving_external_knowledge" ||
    normalized.includes("外部文献检索") ||
    normalized.includes("external-knowledge")
  ) return "external_retrieval_failed";
  if (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("api key")
  ) return "model_authentication_failed";
  if (
    normalized.includes("404") ||
    normalized.includes("not found") ||
    normalized.includes("unsupported route")
  ) return "model_route_unavailable";
  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return "model_rate_limited";
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("econnrefused") ||
    normalized.includes("连接失败")
  ) return "service_unavailable";
  return "artifact_generation_failed";
}

export function extractArtifactTraceId(message: string) {
  return message.match(/\btrace_[A-Za-z0-9._:-]+\b/)?.[0];
}

export function presentArtifactFailure(
  failure: ArtifactTaskFailure,
  developerDiagnostics = false
) {
  const code = failure.code ?? resolveArtifactFailureCode(failure.message, failure.failedStage);
  const traceId = failure.traceId ?? extractArtifactTraceId(failure.message);
  return {
    code,
    diagnostics: developerDiagnostics
      ? {
          endpoint: failure.endpoint,
          message: failure.message,
          model: failure.model,
          provider: failure.provider
        }
      : undefined,
    message: publicMessages[code],
    traceId
  };
}
