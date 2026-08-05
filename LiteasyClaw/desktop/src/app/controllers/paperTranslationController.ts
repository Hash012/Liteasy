import {
  auditTranslationAnchors,
  buildAnchoredTranslationBatches,
  restoreMissingTranslationImages,
  type AnchoredTranslationBatch,
  type TranslationAnchorAudit
} from "../features/import/translationAnchors";

export type TranslationProgressPhase = "preflight" | "translating" | "repairing" | "completed";

export type TranslationProgress = {
  cachedBatches: number;
  completedBatches: number;
  currentBatch?: number;
  message: string;
  phase: TranslationProgressPhase;
  totalBatches: number;
};

export type TranslationRequestOptions = {
  onProgress?: (progress: TranslationProgress) => void;
  signal: AbortSignal;
};

export type PaperTranslationCallback = (
  sourceLanguage: string,
  targetLanguage: string,
  markedSource: string,
  options: TranslationRequestOptions
) => Promise<string>;

export type TranslationModelCall = {
  attempt: "repair" | "translate";
  batch: AnchoredTranslationBatch;
  batchIndex: number;
  prompt: string;
  signal: AbortSignal;
  totalBatches: number;
};

export type TranslationSessionCache = Pick<Map<string, string>, "get" | "set">;

export type TranslationHealthResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

export type TranslationHealthTransport = (input: {
  signal: AbortSignal;
  url: string;
}) => Promise<TranslationHealthResponse>;

export type PaperTranslationErrorCode =
  | "aborted"
  | "anchor_integrity"
  | "direct_upstream_endpoint"
  | "invalid_endpoint"
  | "invalid_health_response"
  | "legacy_mosshub"
  | "model_authentication"
  | "model_rate_limited"
  | "model_timeout"
  | "model_unavailable"
  | "service_unavailable"
  | "source_invalid";

export class PaperTranslationError extends Error {
  readonly action: string;
  readonly code: PaperTranslationErrorCode;
  readonly detail: string;
  readonly title: string;

  constructor(input: {
    action: string;
    code: PaperTranslationErrorCode;
    detail: string;
    title: string;
  }) {
    super(`${input.title}：${input.detail} ${input.action}`);
    this.name = "PaperTranslationError";
    this.action = input.action;
    this.code = input.code;
    this.detail = input.detail;
    this.title = input.title;
  }
}

export type CreatePaperTranslationControllerInput = {
  batchCharacterLimit?: number;
  cache: TranslationSessionCache;
  cacheNamespace?: string;
  endpoint: string;
  generate: (input: TranslationModelCall) => Promise<string>;
  healthTransport?: TranslationHealthTransport;
  paperTitle: string;
};

export type PaperTranslationController = {
  translate: PaperTranslationCallback;
};

const defaultBatchCharacterLimit = 24_000;
const legacyMosshubPattern = /(?:^|\.)api\.mosshubs\.com$/i;

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("翻译已取消。", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

function safeUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "") || parsed.origin;
  } catch {
    return "无效地址";
  }
}

function safeDetail(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/[^\s，）)\]}]+/gi, (value) => safeUrl(value))
    .replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/gi, "[已隐藏密钥]")
    .replace(/(authorization|api[_-]?key)\s*[:=]\s*[^\s,，;；]+/gi, "$1=[已隐藏]")
    .slice(0, 500);
}

function legacyEndpointError(detail: string) {
  return new PaperTranslationError({
    action: "请停止并重启正在监听本地端口的 dev-cloud 进程，确认 .env.local 中的 OPENAI_BASE_URL 已生效。",
    code: "legacy_mosshub",
    detail,
    title: "本地翻译服务仍在使用旧的 Mosshub 配置"
  });
}

function parseTranslationEndpoint(endpoint: string) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new PaperTranslationError({
      action: "请将云代理端点设置为正在运行的本地服务，例如 http://127.0.0.1:8791。",
      code: "invalid_endpoint",
      detail: "云代理端点不是有效 URL。",
      title: "翻译服务地址无效"
    });
  }
  if (legacyMosshubPattern.test(parsed.hostname)) {
    throw legacyEndpointError("前端当前仍指向 api.mosshubs.com，而不是本地代理。");
  }
  const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !isLoopback) {
    throw new PaperTranslationError({
      action: "请把上游 API 密钥留在 dev-cloud，并将前端端点改为 http://127.0.0.1:8791。",
      code: "direct_upstream_endpoint",
      detail: `翻译只连接本机代理；当前地址为 ${safeUrl(endpoint)}。`,
      title: "已阻止前端直连上游模型服务"
    });
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new PaperTranslationError({
      action: "请填写本地服务根地址，例如 http://127.0.0.1:8791，不要附加 /v1、密钥或查询参数。",
      code: "invalid_endpoint",
      detail: "云代理端点必须是无凭据、无路径的本机服务根地址。",
      title: "翻译服务地址无效"
    });
  }
  return parsed.origin;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function healthUpstreamBaseUrl(payload: Record<string, unknown>) {
  const runtime = record(payload.runtime);
  const candidates = [
    runtime?.upstreamBaseUrl,
    runtime?.openaiApiBaseUrl,
    payload.upstreamBaseUrl,
    payload.openaiApiBaseUrl,
    payload.modelBaseUrl,
    payload.upstream
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

async function defaultHealthTransport(input: { signal: AbortSignal; url: string }) {
  return fetch(input.url, { method: "GET", signal: input.signal });
}

export async function preflightTranslationService(input: {
  endpoint: string;
  healthTransport?: TranslationHealthTransport;
  signal: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const origin = parseTranslationEndpoint(input.endpoint);
  let response: TranslationHealthResponse;
  try {
    response = await (input.healthTransport ?? defaultHealthTransport)({
      signal: input.signal,
      url: `${origin}/healthz`
    });
  } catch (error) {
    if (isAbortError(error, input.signal)) throw abortReason(input.signal);
    throw new PaperTranslationError({
      action: "请启动或重启该端口上的 dev-cloud 服务，然后重试翻译。",
      code: "service_unavailable",
      detail: `无法连接 ${origin} 的健康检查。`,
      title: "本地翻译服务不可用"
    });
  }
  throwIfAborted(input.signal);
  if (!response.ok) {
    throw new PaperTranslationError({
      action: "请确认端口对应的是 LiteasyClaw dev-cloud，并重启实际监听进程。",
      code: "service_unavailable",
      detail: `健康检查返回 HTTP ${response.status}。`,
      title: "本地翻译服务未就绪"
    });
  }
  let payload: Record<string, unknown> | undefined;
  try {
    payload = record(await response.json());
  } catch {
    if (input.signal.aborted) throw abortReason(input.signal);
    payload = undefined;
  }
  throwIfAborted(input.signal);
  if (!payload || payload.ok !== true) {
    throw new PaperTranslationError({
      action: "请确认本地端口没有被其他程序占用，并重启 dev-cloud。",
      code: "invalid_health_response",
      detail: "健康检查未返回有效的 LiteasyClaw 状态。",
      title: "翻译服务身份校验失败"
    });
  }
  const runtime = record(payload.runtime);
  if (
    runtime?.hasApiKey === false &&
    (runtime.provider === "openai" || runtime.provider === undefined)
  ) {
    throw new PaperTranslationError({
      action: "请在 dev-cloud/.env.local 中配置 OPENAI_API_KEY，并重启当前本地服务。",
      code: "model_authentication",
      detail: "健康检查显示当前 OpenAI 模型密钥尚未生效。",
      title: "本地模型服务缺少密钥"
    });
  }
  const upstream = healthUpstreamBaseUrl(payload);
  if (upstream) {
    try {
      if (legacyMosshubPattern.test(new URL(upstream).hostname)) {
        throw legacyEndpointError("健康检查显示运行中的进程仍将上游指向 api.mosshubs.com。 ");
      }
    } catch (error) {
      if (error instanceof PaperTranslationError) throw error;
      // An older health payload may expose a non-URL provider label. It still
      // proves the endpoint is our service, so retain backward compatibility.
    }
  }
  return { origin, payload };
}

function auditSummary(audit: TranslationAnchorAudit) {
  const issues = [
    audit.missingIds.length > 0 ? `缺少 ${audit.missingIds.join("、")}` : "",
    audit.duplicateIds.length > 0 ? `重复 ${audit.duplicateIds.join("、")}` : "",
    audit.unexpectedIds.length > 0 ? `多出 ${audit.unexpectedIds.join("、")}` : "",
    audit.emptyIds.length > 0 ? `内容为空 ${audit.emptyIds.join("、")}` : "",
    audit.outOfOrder ? "锚点顺序改变" : "",
    audit.malformedMarkers.length > 0 ? "锚点格式被改写" : "",
    audit.hasUnanchoredPrefix ? "首个锚点前出现额外内容" : ""
  ].filter(Boolean);
  return issues.join("；") || "锚点数量或格式不一致";
}

function translationPrompt(input: {
  batch: AnchoredTranslationBatch;
  batchIndex: number;
  paperTitle: string;
  sourceLanguage: string;
  targetLanguage: string;
  totalBatches: number;
}) {
  return [
    `将以下${input.sourceLanguage}论文 MinerU 提取文本翻译成${input.targetLanguage}。`,
    `论文：${input.paperTitle}。这是第 ${input.batchIndex + 1}/${input.totalBatches} 批，请保持学术术语前后一致。`,
    "保留 Markdown 结构、LaTeX 公式、表格和图片引用；不要添加解释、不要省略内容。",
    `以下同步锚点必须逐字保留、各出现一次且保持顺序：${input.batch.anchorIds.join("、")}。不得翻译、删除、移动或新建锚点。`,
    input.batch.markedSource
  ].join("\n\n");
}

function repairPrompt(input: {
  audit: TranslationAnchorAudit;
  batch: AnchoredTranslationBatch;
  candidate: string;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  return [
    `修复下面这批${input.sourceLanguage}到${input.targetLanguage}的论文翻译。只输出修复后的完整译文。`,
    `锚点审计失败：${auditSummary(input.audit)}。`,
    `必须逐字输出这些锚点，各一次且顺序不变：${input.batch.anchorIds.join("、")}。不要在首个锚点前输出说明。`,
    "原文：",
    input.batch.markedSource,
    "待修复译文：",
    input.candidate
  ].join("\n\n");
}

function cacheKey(input: {
  batch: AnchoredTranslationBatch;
  namespace: string;
  paperTitle: string;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  return JSON.stringify([
    "paper-translation-v1",
    input.namespace,
    input.paperTitle,
    input.sourceLanguage,
    input.targetLanguage,
    input.batch.markedSource
  ]);
}

export function classifyPaperTranslationError(error: unknown): PaperTranslationError {
  if (error instanceof PaperTranslationError) return error;
  const detail = safeDetail(error);
  if (/api\.mosshubs\.com/i.test(detail)) {
    return legacyEndpointError("模型请求暴露了旧的 api.mosshubs.com 上游配置。");
  }
  if (/\b(?:401|403)\b|unauthori[sz]ed|api[_ -]?key/i.test(detail)) {
    return new PaperTranslationError({
      action: "请检查 dev-cloud/.env.local 中的 OPENAI_API_KEY，并重启本地服务。",
      code: "model_authentication",
      detail,
      title: "模型服务认证失败"
    });
  }
  if (/\b429\b|rate.?limit|quota/i.test(detail)) {
    return new PaperTranslationError({
      action: "请稍后重试；已完成的翻译批次保留在本次会话缓存中。",
      code: "model_rate_limited",
      detail,
      title: "模型服务请求过于频繁"
    });
  }
  if (/\b(?:408|524)\b|time.?out|超时/i.test(detail)) {
    return new PaperTranslationError({
      action: "请重试；系统会复用本次会话中已完成的批次。若持续失败，请检查上游服务状态。",
      code: "model_timeout",
      detail,
      title: "翻译请求超时"
    });
  }
  if (/\b(?:500|502|503|504|520|522)\b|fetch failed|network|连接失败/i.test(detail)) {
    return new PaperTranslationError({
      action: "请确认本地代理仍在运行并重试；已完成批次不会重复请求。",
      code: "model_unavailable",
      detail,
      title: "模型服务暂时不可用"
    });
  }
  return new PaperTranslationError({
    action: "请重试；若问题持续，请检查本地服务日志。",
    code: "model_unavailable",
    detail: detail || "模型请求未成功完成。",
    title: "论文翻译失败"
  });
}

export function createPaperTranslationController(
  input: CreatePaperTranslationControllerInput
): PaperTranslationController {
  const maximumCharacters = input.batchCharacterLimit ?? defaultBatchCharacterLimit;

  return {
    async translate(sourceLanguage, targetLanguage, markedSource, options) {
      throwIfAborted(options.signal);
      let batches: AnchoredTranslationBatch[];
      try {
        batches = buildAnchoredTranslationBatches(markedSource, maximumCharacters);
      } catch (error) {
        throw new PaperTranslationError({
          action: "请重新载入论文提取内容后再试。",
          code: "source_invalid",
          detail: safeDetail(error),
          title: "无法安全拆分翻译原文"
        });
      }
      options.onProgress?.({
        cachedBatches: 0,
        completedBatches: 0,
        message: "正在检查本地翻译服务…",
        phase: "preflight",
        totalBatches: batches.length
      });
      await preflightTranslationService({
        endpoint: input.endpoint,
        healthTransport: input.healthTransport,
        signal: options.signal
      });

      const results: string[] = [];
      let cachedBatches = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        throwIfAborted(options.signal);
        const batch = batches[batchIndex];
        const key = cacheKey({
          batch,
          namespace: input.cacheNamespace ?? input.endpoint,
          paperTitle: input.paperTitle,
          sourceLanguage,
          targetLanguage
        });
        const cached = input.cache.get(key);
        if (typeof cached === "string" && auditTranslationAnchors(cached, batch.anchorIds).valid) {
          results.push(cached.trim());
          cachedBatches += 1;
          options.onProgress?.({
            cachedBatches,
            completedBatches: results.length,
            currentBatch: batchIndex + 1,
            message: `已从本次会话恢复第 ${batchIndex + 1}/${batches.length} 批。`,
            phase: "translating",
            totalBatches: batches.length
          });
          continue;
        }

        options.onProgress?.({
          cachedBatches,
          completedBatches: results.length,
          currentBatch: batchIndex + 1,
          message: `正在翻译第 ${batchIndex + 1}/${batches.length} 批…`,
          phase: "translating",
          totalBatches: batches.length
        });
        let candidate: string;
        try {
          candidate = await input.generate({
            attempt: "translate",
            batch,
            batchIndex,
            prompt: translationPrompt({
              batch,
              batchIndex,
              paperTitle: input.paperTitle,
              sourceLanguage,
              targetLanguage,
              totalBatches: batches.length
            }),
            signal: options.signal,
            totalBatches: batches.length
          });
        } catch (error) {
          if (isAbortError(error, options.signal)) throw abortReason(options.signal);
          throw classifyPaperTranslationError(error);
        }
        throwIfAborted(options.signal);
        let audit = auditTranslationAnchors(candidate, batch.anchorIds);
        if (!audit.valid) {
          options.onProgress?.({
            cachedBatches,
            completedBatches: results.length,
            currentBatch: batchIndex + 1,
            message: `第 ${batchIndex + 1}/${batches.length} 批锚点异常，正在自动修复…`,
            phase: "repairing",
            totalBatches: batches.length
          });
          try {
            candidate = await input.generate({
              attempt: "repair",
              batch,
              batchIndex,
              prompt: repairPrompt({
                audit,
                batch,
                candidate: candidate.slice(0, maximumCharacters),
                sourceLanguage,
                targetLanguage
              }),
              signal: options.signal,
              totalBatches: batches.length
            });
          } catch (error) {
            if (isAbortError(error, options.signal)) throw abortReason(options.signal);
            throw classifyPaperTranslationError(error);
          }
          throwIfAborted(options.signal);
          audit = auditTranslationAnchors(candidate, batch.anchorIds);
          if (!audit.valid) {
            throw new PaperTranslationError({
              action: "请重试该翻译；已通过审计的批次会从本次会话缓存恢复。",
              code: "anchor_integrity",
              detail: `第 ${batchIndex + 1} 批自动修复后仍未通过锚点审计：${auditSummary(audit)}。`,
              title: "译文同步锚点无法修复"
            });
          }
        }
        candidate = restoreMissingTranslationImages(batch.markedSource, candidate);
        const completed = candidate.trim();
        input.cache.set(key, completed);
        results.push(completed);
        options.onProgress?.({
          cachedBatches,
          completedBatches: results.length,
          currentBatch: batchIndex + 1,
          message: `已完成第 ${batchIndex + 1}/${batches.length} 批。`,
          phase: "translating",
          totalBatches: batches.length
        });
      }

      const translation = results.join("\n\n");
      const expectedIds = batches.flatMap(({ anchorIds }) => anchorIds);
      const finalAudit = auditTranslationAnchors(translation, expectedIds);
      if (!finalAudit.valid) {
        throw new PaperTranslationError({
          action: "请重试该翻译。",
          code: "anchor_integrity",
          detail: `合并译文未通过锚点审计：${auditSummary(finalAudit)}。`,
          title: "译文同步校验失败"
        });
      }
      options.onProgress?.({
        cachedBatches,
        completedBatches: batches.length,
        message: cachedBatches === batches.length ? "已从本次会话恢复完整译文。" : "论文翻译完成。",
        phase: "completed",
        totalBatches: batches.length
      });
      return translation;
    }
  };
}
