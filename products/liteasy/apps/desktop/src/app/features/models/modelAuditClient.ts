import type { AnswerAuditResult } from "../assistant/answerAuditor";
import type { Citation } from "../retrieval/retrieval.types";
import type { ModelClientSource, ModelTransportResponse } from "./modelHttpClient";

export type ModelAuditTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
  signal?: AbortSignal;
};

export type ModelAuditTransport = (
  request: ModelAuditTransportRequest
) => Promise<ModelTransportResponse>;

type CreateHttpModelAuditClientInput = {
  endpoint: string;
  source: ModelClientSource;
  transport?: ModelAuditTransport;
  timeoutMs?: number;
};

type ModelAuditClientInput = {
  answer: string;
  citations: Citation[];
  model: string;
  provider: string;
  question: string;
  retrievalConfidence: number;
  signal?: AbortSignal;
};

type ModelAuditPayload = {
  audit: { model: string; rationale: string; score: number; verdict: "pass" | "review" | "fail" };
};

type AuditFailureReason = NonNullable<AnswerAuditResult["remoteAttempt"]>["reason"];

export class ModelAuditError extends Error {
  readonly status: "failed" | "timed_out";
  constructor(readonly reason: Exclude<AuditFailureReason, undefined>) {
    super(reason === "timeout" ? "远端审计服务超时，尚未完成语义核验。" : "远端审计服务未完成有效检查，尚未完成语义核验。");
    this.name = "ModelAuditError";
    this.status = reason === "timeout" ? "timed_out" : "failed";
  }
}

export function auditWithRemoteFailure(localAudit: AnswerAuditResult, error: unknown): AnswerAuditResult {
  const failure = error instanceof ModelAuditError ? error : new ModelAuditError("network_error");
  return {
    ...localAudit,
    status: failure.status,
    remoteAttempt: { status: failure.status, reason: failure.reason },
    rationale: `${failure.message} 已保留本地结构检查结果。`
  };
}

function isAuditPayload(payload: unknown): payload is ModelAuditPayload {
  if (!payload || typeof payload !== "object" || !("audit" in payload)) return false;
  const audit = payload.audit;
  return Boolean(audit && typeof audit === "object" &&
    "model" in audit && typeof audit.model === "string" && audit.model.length > 0 && audit.model.length <= 200 &&
    "rationale" in audit && typeof audit.rationale === "string" &&
    "score" in audit && typeof audit.score === "number" && Number.isFinite(audit.score) && audit.score >= 0 && audit.score <= 1 &&
    "verdict" in audit && (audit.verdict === "pass" || audit.verdict === "review" || audit.verdict === "fail"));
}

async function defaultTransport(request: ModelAuditTransportRequest): Promise<ModelTransportResponse> {
  return fetch(request.url, { body: request.body, headers: request.headers, method: request.method, signal: request.signal });
}

export function createHttpModelAuditClient({ endpoint, source, transport = defaultTransport, timeoutMs = 10_000 }: CreateHttpModelAuditClientInput) {
  return async ({ signal, ...input }: ModelAuditClientInput): Promise<AnswerAuditResult> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interruption = new Promise<never>((_, reject) => {
      onAbort = () => { controller.abort(); reject(new DOMException("审计请求已取消", "AbortError")); };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new ModelAuditError("timeout")); },
        Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 30_000)) : 10_000);
      if (signal?.aborted) onAbort();
    });
    const execute = async (): Promise<AnswerAuditResult> => {
      if (controller.signal.aborted) throw new DOMException("审计请求已取消", "AbortError");
      let response: ModelTransportResponse;
      try {
        response = await transport({
          body: JSON.stringify({ ...input, source }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          url: `${endpoint.replace(/\/+$/, "")}/v1/model/audit`,
          signal: controller.signal
        });
      } catch {
        throw new ModelAuditError("network_error");
      }
      if (!response.ok) throw new ModelAuditError("http_error");
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new ModelAuditError("invalid_response"); }
      if (!isAuditPayload(payload)) throw new ModelAuditError("invalid_response");
      // This legacy endpoint has no per-claim execution receipt. Its self-reported
      // model, score and verdict cannot establish either identity or support.
      return {
        model: "remote_service",
        checkerKind: "remote_service",
        status: "completed",
        semanticStatus: "unverified",
        reportedModel: payload.audit.model,
        remoteAttempt: { status: "completed" },
        rationale: "远端审计服务返回；实际模型身份与逐条核验记录无法确认，结论仍待核验。",
        score: payload.audit.score,
        verdict: "review"
      };
    };
    try { return await Promise.race([interruption, execute()]); }
    finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  };
}
