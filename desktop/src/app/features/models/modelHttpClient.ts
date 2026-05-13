import type { GenerateAnswerInput, ModelGenerationResult } from "./modelGateway";
import type { ModelExecutionTrace } from "./modelExecution";

export type ModelClientSource = "cloud_proxy" | "local_direct";

export type ModelTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type ModelTransportResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

export type ModelTransport = (
  request: ModelTransportRequest
) => Promise<ModelTransportResponse>;

type CreateHttpModelClientInput = {
  endpoint: string;
  source: ModelClientSource;
  transport?: ModelTransport;
};

function buildModelServiceUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/model/generate`;
}

type AnswerPayload = {
  answer: string;
  execution?: {
    backend?: string;
    mode?: string;
    provider?: string;
  };
};

function isAnswerPayload(payload: unknown): payload is AnswerPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "answer" in payload &&
    typeof payload.answer === "string"
  );
}

function buildExecutionTrace(
  payload: AnswerPayload,
  endpoint: string,
  source: ModelClientSource
): ModelExecutionTrace {
  const backend = payload.execution?.backend === "dev_cloud" ? "dev_cloud" : "http_service";
  const mode =
    payload.execution?.mode === "live" ||
    payload.execution?.mode === "mock" ||
    payload.execution?.mode === "mock_fallback"
      ? payload.execution.mode
      : "unknown";

  return {
    backend,
    endpoint,
    mode,
    provider: typeof payload.execution?.provider === "string" ? payload.execution.provider : "unknown",
    source
  };
}

async function defaultTransport(request: ModelTransportRequest): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createHttpModelClient({
  endpoint,
  source,
  transport = defaultTransport
}: CreateHttpModelClientInput) {
  return async (input: GenerateAnswerInput): Promise<ModelGenerationResult> => {
    const response = await transport({
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        provider: input.provider,
        source
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildModelServiceUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`模型服务请求失败（${source} ${response.status}）`);
    }

    const payload = await response.json();
    if (!isAnswerPayload(payload)) {
      throw new Error(`模型服务返回格式无效（${source}）`);
    }

    return {
      answer: payload.answer,
      trace: buildExecutionTrace(payload, endpoint, source)
    };
  };
}
