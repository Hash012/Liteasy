const browserFetchFailureMessages = new Set([
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "Load failed"
]);

type CloudConnectionErrorOptions = {
  controlPlaneEndpoint?: string;
};

type CloudErrorResponse = {
  json: () => Promise<unknown>;
  status: number;
};

type CloudServiceErrorInput = {
  code: string;
  message: string;
  status: number;
  traceId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolToken(value: unknown) {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return /^[A-Za-z][A-Za-z0-9._:-]{0,191}$/.test(token) ? token : undefined;
}

function publicMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const message = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return message ? message.slice(0, 500) : undefined;
}

export class CloudServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly traceId?: string;

  constructor({ code, message, status, traceId }: CloudServiceErrorInput) {
    super(message);
    this.name = code;
    this.code = code;
    this.status = status;
    this.traceId = traceId;
  }
}

export async function readCloudServiceError(
  response: CloudErrorResponse,
  fallback: { code: string; message: string }
) {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const code = isRecord(payload) ? protocolToken(payload.code) : undefined;
  const traceId = isRecord(payload) ? protocolToken(payload.traceId) : undefined;
  const message = isRecord(payload) ? publicMessage(payload.message) : undefined;
  return new CloudServiceError({
    code: code ?? fallback.code,
    message: message ?? fallback.message,
    status: response.status,
    ...(traceId ? { traceId } : {})
  });
}

export function formatCloudConnectionError(error: unknown, options: CloudConnectionErrorOptions = {}) {
  if (error instanceof Error && browserFetchFailureMessages.has(error.message)) {
    return "云端服务当前不可用，请检查网络连接后重试。";
  }

  if (error instanceof CloudServiceError) {
    const trace = error.traceId ? `，追踪编号：${error.traceId}` : "";
    return `${error.message}（错误码：${error.code}${trace}）`;
  }

  void options;
  return "云端操作未完成，请稍后重试。";
}
