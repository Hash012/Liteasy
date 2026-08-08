import type { GenerateAnswerInput, ModelGenerationResult } from "./modelGateway";
import type { ModelExecutionTrace } from "./modelExecution";

export type ModelClientSource = "cloud_proxy";

export type ModelTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  signal?: AbortSignal;
  url: string;
};

export type ModelTransportResponse = {
  body?: ReadableStream<Uint8Array> | null;
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

export type ModelTransport = (
  request: ModelTransportRequest
) => Promise<ModelTransportResponse>;

type BearerModelTransportInput = {
  fetchImpl?: typeof fetch;
  getAccessToken: () => string | null | undefined;
};

type CreateHttpModelClientInput = {
  endpoint: string;
  source: ModelClientSource;
  transport?: ModelTransport;
};

function buildModelServiceUrl(endpoint: string, stream = false) {
  return `${endpoint.replace(/\/+$/, "")}/v1/model/${stream ? "generate-stream" : "generate"}`;
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

async function readBackendError(response: ModelTransportResponse) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object") {
      if ("message" in payload && typeof payload.message === "string") {
        const trace = "traceId" in payload && typeof payload.traceId === "string"
          ? `（${payload.traceId}）`
          : "";
        return `${payload.message}${trace}`;
      }
      if ("error" in payload && typeof payload.error === "string") {
        return payload.error;
      }
      if ("code" in payload && typeof payload.code === "string") {
        return payload.code;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function buildExecutionTrace(
  payload: AnswerPayload,
  endpoint: string,
  source: ModelClientSource
): ModelExecutionTrace {
  const backend = payload.execution?.backend === "dev_cloud" ? "dev_cloud" : "http_service";
  const mode =
    payload.execution?.mode === "live"
      ? "live"
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
    method: request.method,
    signal: request.signal
  });
}

export function createBearerModelTransport({
  fetchImpl = fetch,
  getAccessToken
}: BearerModelTransportInput): ModelTransport {
  return async (request) => {
    const accessToken = getAccessToken()?.trim();
    if (!accessToken) {
      throw new Error("请先登录 Liteasy 账号，再使用云端模型服务。");
    }
    return fetchImpl(request.url, {
      body: request.body,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${accessToken}`
      },
      method: request.method,
      signal: request.signal
    });
  };
}

async function readStreamingAnswer(input: {
  endpoint: string;
  generateInput: GenerateAnswerInput;
  response: ModelTransportResponse;
  source: ModelClientSource;
}) {
  if (!input.response.body) {
    throw new Error(`模型流式响应缺少可读数据（${input.source}）`);
  }
  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";
  let buffer = "";
  let completedPayload: AnswerPayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`模型流式响应格式无效（${input.source}）`);
      }
      if (!event || typeof event !== "object") {
        continue;
      }
      if ("type" in event && event.type === "error") {
        const detail = "message" in event && typeof event.message === "string"
          ? event.message
          : "code" in event && typeof event.code === "string"
            ? event.code
            : "error" in event && typeof event.error === "string"
              ? event.error
              : "unknown_stream_error";
        const trace = "traceId" in event && typeof event.traceId === "string"
          ? `（${event.traceId}）`
          : "";
        throw new Error(`模型流式请求失败（${input.source}）：${detail}${trace}`);
      }
      if (
        "type" in event &&
        event.type === "delta" &&
        "delta" in event &&
        typeof event.delta === "string"
      ) {
        answer += event.delta;
        input.generateInput.onDelta?.(event.delta, answer);
      }
      if ("type" in event && event.type === "completed" && isAnswerPayload(event)) {
        completedPayload = event;
      }
    }
    if (done) {
      break;
    }
  }

  if (!completedPayload) {
    throw new Error(`模型流式响应未正常完成（${input.source}）`);
  }
  return {
    answer: completedPayload.answer || answer,
    trace: buildExecutionTrace(completedPayload, input.endpoint, input.source)
  };
}

export function createHttpModelClient({
  endpoint,
  source,
  transport = defaultTransport
}: CreateHttpModelClientInput) {
  return async (input: GenerateAnswerInput): Promise<ModelGenerationResult> => {
    const transportRequest: ModelTransportRequest = {
      body: JSON.stringify({
        model: input.model,
        ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
        prompt: input.prompt,
        provider: input.provider,
        ...(input.requireLive ? { requireLive: true } : {}),
        source
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildModelServiceUrl(endpoint, Boolean(input.onDelta))
    };
    if (input.signal) {
      transportRequest.signal = input.signal;
    }
    const response = await transport(transportRequest);

    if (!response.ok) {
      const detail = await readBackendError(response);
      throw new Error(
        detail
          ? `模型服务请求失败（${source} ${response.status}）：${detail}`
          : `模型服务请求失败（${source} ${response.status}）`
      );
    }

    if (input.onDelta) {
      return readStreamingAnswer({
        endpoint,
        generateInput: input,
        response,
        source
      });
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
