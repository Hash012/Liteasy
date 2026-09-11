import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { directModelNeedsKey, validateDirectModelConfig, type DirectModelConfig } from "./modelProviders";

export type DirectModelRequest = {
  config: DirectModelConfig;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onChunk?: (chunk: Uint8Array) => void;
};
export type DirectModelTransport = (request: DirectModelRequest) => Promise<string>;

// Browser previews retain credentials only for this page session. Installed apps
// keep keys in the OS credential store and never return them to the WebView.
const sessionKeys = new Map<string, string>();
function credentialScope(config: DirectModelConfig) {
  const valid = validateDirectModelConfig(config);
  return `${valid.provider}:${valid.endpoint}`;
}

export async function hasDirectModelKey(config: DirectModelConfig): Promise<boolean> {
  if (isTauri()) return invoke("has_direct_model_key", { config });
  return sessionKeys.has(credentialScope(config));
}

export async function saveDirectModelKey(config: DirectModelConfig, apiKey: string) {
  if (!apiKey.trim() || /[\r\n]/.test(apiKey) || apiKey.length > 8192) throw new Error("请填写有效的 API key。");
  if (isTauri()) await invoke("save_direct_model_key", { config, apiKey: apiKey.trim() });
  else sessionKeys.set(credentialScope(config), apiKey.trim());
}

export async function deleteDirectModelKey(config: DirectModelConfig) {
  if (isTauri()) await invoke("delete_direct_model_key", { config });
  else sessionKeys.delete(credentialScope(config));
}

export const directModelTransport: DirectModelTransport = async ({ config: inputConfig, body, signal, onChunk }) => {
  const config = validateDirectModelConfig(inputConfig);
  signal?.throwIfAborted();
  if (isTauri()) {
    const requestId = crypto.randomUUID();
    const chunks = new Channel<number[]>();
    let completeStream = () => {};
    const streamCompleted = new Promise<void>((resolve) => { completeStream = resolve; });
    chunks.onmessage = (bytes) => {
      if (bytes.length === 0) completeStream();
      else if (!signal?.aborted) onChunk?.(new Uint8Array(bytes));
    };
    const cancel = () => {
      completeStream();
      void invoke("cancel_direct_model_request", { requestId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await invoke<string>("request_direct_model", { config, body, requestId, chunks });
      // The command response can precede large IPC channel chunks. The empty
      // chunk is an ordered end marker, so wait for it before parsing completion.
      if (onChunk) await streamCompleted;
      signal?.throwIfAborted();
      return response;
    } catch (error) {
      signal?.throwIfAborted();
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  const key = sessionKeys.get(credentialScope(config));
  if (!key && directModelNeedsKey(config)) throw new Error("请先在设置 → AI 接入中保存 API key。");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.protocol === "anthropic") {
    headers["x-api-key"] = key ?? "";
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (key) headers[config.provider === "azure" ? "api-key" : "Authorization"] = config.provider === "azure" ? key : `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(`${config.endpoint}/${config.protocol === "anthropic" ? "messages" : "chat/completions"}`, {
      method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error"
    });
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error("无法连接 API。请检查网络与地址；若服务商限制浏览器跨域访问，请使用桌面安装版。");
  }
  if (!response.ok) throw new Error(directModelHttpError(response.status));
  if (!onChunk) return response.text();
  if (!response.body) throw new Error("API 没有返回可读取的响应。");
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return "";
};

export function directModelHttpError(status: number) {
  const detail = status === 401 || status === 403 ? "密钥无效或没有模型访问权限"
    : status === 429 ? "额度不足或请求过于频繁"
      : status === 404 ? "请检查 API 地址和模型 ID"
        : status === 400 ? "请检查模型、API 协议和结构化输出设置" : "服务暂时不可用，请稍后重试";
  return `API 请求失败（HTTP ${status}）：${detail}。`;
}
