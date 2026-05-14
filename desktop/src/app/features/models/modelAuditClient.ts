import type { AnswerAuditResult } from "../assistant/answerAuditor";
import type { Citation } from "../retrieval/retrieval.types";
import type { ModelClientSource, ModelTransportResponse } from "./modelHttpClient";

export type ModelAuditTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type ModelAuditTransport = (
  request: ModelAuditTransportRequest
) => Promise<ModelTransportResponse>;

type CreateHttpModelAuditClientInput = {
  endpoint: string;
  source: ModelClientSource;
  transport?: ModelAuditTransport;
};

type ModelAuditClientInput = {
  answer: string;
  citations: Citation[];
  model: AnswerAuditResult["model"];
  provider: string;
  question: string;
  retrievalConfidence: number;
};

type ModelAuditPayload = {
  audit: AnswerAuditResult;
};

function buildModelAuditUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/model/audit`;
}

function isAuditPayload(payload: unknown): payload is ModelAuditPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "audit" in payload &&
    typeof payload.audit === "object" &&
    payload.audit !== null &&
    "model" in payload.audit &&
    payload.audit.model === "gpt-5-mini-auditor" &&
    "rationale" in payload.audit &&
    typeof payload.audit.rationale === "string" &&
    "score" in payload.audit &&
    typeof payload.audit.score === "number" &&
    "verdict" in payload.audit &&
    (payload.audit.verdict === "pass" ||
      payload.audit.verdict === "review" ||
      payload.audit.verdict === "fail")
  );
}

async function defaultTransport(
  request: ModelAuditTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createHttpModelAuditClient({
  endpoint,
  source,
  transport = defaultTransport
}: CreateHttpModelAuditClientInput) {
  return async (input: ModelAuditClientInput): Promise<AnswerAuditResult> => {
    const response = await transport({
      body: JSON.stringify({
        ...input,
        source
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildModelAuditUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`模型审计请求失败（${source} ${response.status}）`);
    }

    const payload = await response.json();
    if (!isAuditPayload(payload)) {
      throw new Error(`模型审计返回格式无效（${source}）`);
    }

    return payload.audit;
  };
}
