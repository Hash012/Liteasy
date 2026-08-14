import type {
  ArtifactFailureCode,
  ArtifactTaskFailure,
  ArtifactTaskStage
} from "./artifact.types";

export type { ArtifactFailureCode } from "./artifact.types";

const publicMessages: Record<ArtifactFailureCode, string> = {
  artifact_generation_failed: "生成任务未完成，请稍后重试。",
  artifact_verification_failed: "生成结果未通过结构、证据或安全校验，系统未保存该结果。",
  document_processing_failed: "PDF 处理未完成，请确认文件可用后重新导入。",
  external_retrieval_failed: "外部文献检索暂时不可用，请稍后重试。",
  model_authentication_failed: "请登录或重新登录 Liteasy 账号，再使用模型服务。",
  model_rate_limited: "模型服务当前请求较多，请稍后重试。",
  model_route_unavailable: "模型服务暂不支持该请求，请稍后重试。",
  service_unavailable: "相关服务暂时不可用，请检查网络后重试。"
};

function verificationFailureMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("首页方向质量门")) {
    return "薄读正文未通过首页方向审阅，系统未保存该结果。请缩小问题范围或重新生成。";
  }
  if (normalized.includes("数值命题门")) {
    return "薄读正文中的数值与来源未能一致对应，系统未保存该结果。请重新生成或减少精确数值要求。";
  }
  if (normalized.includes("证据复核未通过")) {
    return "薄读正文中仍有命题缺少来源直接支持，系统未保存该结果。请确认论文能够回答当前问题后重试。";
  }
  if (normalized.includes("成文质量审阅")) {
    return "薄读正文的重点、逻辑或解释深度未通过审阅，系统未保存该结果。请缩小问题范围后重试。";
  }
  if (normalized.includes("来源约束无法满足")) {
    return "当前论文或所选来源不足以支持这次薄读，系统未保存无可靠依据的结果。请调整问题或补充来源。";
  }
  if (normalized.includes("ai 独立理解质量审阅未通过")) {
    return "AI 独立分析中仍包含无法安全确认的事实性内容，系统未保存该结果。请补充可靠来源后重试。";
  }
  if (normalized.includes("结构质量门")) {
    return "模型连续返回了不符合薄读结构要求的结果，系统未保存该结果。请重新生成。";
  }
  return publicMessages.artifact_verification_failed;
}

export function isModelAuthenticationFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("api key") ||
    normalized.includes("invalid_session") ||
    normalized.includes("session_validation_failed") ||
    normalized.includes("请先登录") ||
    normalized.includes("重新登录") ||
    normalized.includes("登录会话无效") ||
    normalized.includes("登录会话已过期")
  );
}

export function resolveArtifactFailureCode(
  message: string,
  failedStage: ArtifactTaskStage
): ArtifactFailureCode {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("审计未通过") ||
    normalized.includes("ai 独立理解质量审阅未通过") ||
    normalized.includes("成文质量审阅") ||
    normalized.includes("来源约束无法满足") ||
    normalized.includes("首页方向质量门") ||
    normalized.includes("结构质量门") ||
    normalized.includes("数值命题门") ||
    normalized.includes("证据复核未通过") ||
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
  if (isModelAuthenticationFailure(message)) return "model_authentication_failed";
  if (
    normalized.includes("404") ||
    normalized.includes("not found") ||
    normalized.includes("unsupported route")
  ) return "model_route_unavailable";
  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return "model_rate_limited";
  }
  if (
    normalized.includes("model_provider_timeout") ||
    normalized.includes("model_provider_unavailable") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("econnrefused") ||
    normalized.includes("连接失败") ||
    /(?:cloud_proxy|responses api).*\b(?:408|500|502|503|504)\b/.test(normalized)
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
    message: code === "artifact_verification_failed"
      ? verificationFailureMessage(failure.message)
      : publicMessages[code],
    traceId
  };
}
