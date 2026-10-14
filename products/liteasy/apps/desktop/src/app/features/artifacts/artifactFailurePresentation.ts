import type {
  ArtifactFailureCode,
  ArtifactTaskFailure,
  ArtifactTaskStage
} from "./artifact.types";
import { redactDiagnostic } from "../context/objectContext";

export type { ArtifactFailureCode } from "./artifact.types";

const publicMessages: Record<ArtifactFailureCode, string> = {
  artifact_generation_failed: "这次生成未完成。诊断日志已保留，可交给 AI 排查原因。",
  artifact_verification_failed: "生成结果未通过结构、证据或安全校验，系统未保存该结果。",
  document_processing_failed: "PDF 处理未完成，请确认文件可用后重新导入。",
  external_retrieval_failed: "外部文献检索暂时不可用，请稍后重试。",
  model_authentication_failed: "模型身份验证失败。请在设置 → AI 接入中检查密钥或重新登录当前接入的账号。",
  model_rate_limited: "模型服务当前请求较多，请稍后重试。",
  model_route_unavailable: "模型服务暂不支持该请求，请稍后重试。",
  service_unavailable: "相关服务暂时不可用，请检查网络后重试。"
};

/** Explain actionable failures without exposing provider payloads or opaque IDs. */
function explainFailure(failure: ArtifactTaskFailure, fallback: string) {
  const text = failure.message;
  if (/超时|timeout|timed out/i.test(text)) return "模型生成等待超时。这类任务比普通聊天更耗时，可减少资料或输出篇幅后重试。";
  if (/输出.*(?:预算|长度上限|大小限制)|max_tokens|finish_reason.*length/i.test(text)) return "模型回答超过了本次长度限制，文档没有完整生成。请减少生成篇幅后重试。";
  if (/超出.*预算|context.?length|context window|too many tokens/i.test(text)) return "所选资料和方法说明超出了模型可读取的长度。请减少资料或分段生成。";
  if (/正常完成回执|连接提前结束|连接中断/i.test(text)) return "模型连接在确认完整回答前结束，尚未保存不完整的结果。请检查网络后重试。";
  if (/HTTP 400|json_schema|response_format|invalid.*schema|unsupported.*(?:parameter|format)/i.test(text)) return "模型服务未接受这次文档请求。普通聊天可能仍可用；请检查 AI 接入中的结构化输出方式与所选模型是否兼容。";
  if (/文档校验失败|章节缺失|引文无法|主张.*引用|文档类型不符合/.test(text)) return "模型返回的文档没有通过结构或引用检查，已尝试修复但仍未通过，未保存为正式结果。可让 AI 根据诊断日志调整方法。";
  if (/模型未返回文本|没有.*正文/.test(text)) return "模型没有返回可保存的正文，请换用支持文本回答的模型后重试。";
  if (/disk full|no space|ENOSPC|磁盘空间/i.test(text)) return "磁盘空间不足，结果未能保存。请清理空间后重试保存，无需重新生成。";
  if (/^(?:当前科研方法仅支持文本|请选择不同的主要研究对象|请填写研究问题|资料用途与所选方法不匹配|保存目标|所选方法版本|方法包|账号已变化)/.test(text)
    || /^[^\n]{1,60}需要 \d+–\d+ 项资料$/.test(text)) return redactDiagnostic(text).slice(0, 300);
  return fallback;
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
    message: explainFailure(failure, publicMessages[code]),
    traceId
  };
}
