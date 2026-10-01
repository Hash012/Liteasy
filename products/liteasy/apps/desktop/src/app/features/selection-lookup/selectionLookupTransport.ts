import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LookupServiceConfig, LookupTransport, LookupTransportRequest } from "./selectionLookup.types";

const sessionKeys = new Map<string, string>();
export const lookupResponseLimit = 2 * 1024 * 1024;
export function validateLookupEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请填写有效的翻译服务地址。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error("翻译服务须使用 HTTPS，本机可用 HTTP；地址不能包含密钥或查询参数。");
  }
  return url.href.replace(/\/+$/, "");
}
function credentialConfig(endpoint: string): LookupServiceConfig { return { provider: "libretranslate", endpoint: validateLookupEndpoint(endpoint) }; }
export async function saveLookupKey(endpoint: string, apiKey: string) {
  const config = credentialConfig(endpoint);
  if (!apiKey.trim() || apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw new Error("请填写有效的翻译服务密钥。");
  if (isTauri()) await invoke("save_selection_lookup_key", { config, apiKey: apiKey.trim() });
  else sessionKeys.set(config.endpoint!, apiKey.trim());
}
export async function hasLookupKey(endpoint: string): Promise<boolean> {
  const config = credentialConfig(endpoint);
  return isTauri() ? invoke("has_selection_lookup_key", { config }) : sessionKeys.has(config.endpoint!);
}
export async function deleteLookupKey(endpoint: string) {
  const config = credentialConfig(endpoint);
  if (isTauri()) await invoke("delete_selection_lookup_key", { config });
  else sessionKeys.delete(config.endpoint!);
}
export function lookupHttpRequest(input: LookupTransportRequest, key?: string) {
  const { config, text, sourceLanguage, targetLanguage } = input;
  if (!text.trim() || text.length > 1000) throw new Error("请选中不超过 1,000 字符的单词、短语或短句。");
  if (!/^[a-zA-Z-]{2,16}$/.test(sourceLanguage) || !/^[a-zA-Z-]{2,16}$/.test(targetLanguage) || targetLanguage === "auto") throw new Error("查询语言无效。");
  switch (config.provider) {
    case "bing": return { url: `https://cn.bing.com/dict/search?q=${encodeURIComponent(text)}`, method: "GET" };
    case "youdao": return { url: `https://www.youdao.com/w/${encodeURIComponent(text)}/`, method: "GET" };
    case "free-dictionary": return { url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`, method: "GET" };
    case "libretranslate": return { url: `${validateLookupEndpoint(config.endpoint ?? "")}/translate`, method: "POST",
      body: JSON.stringify({ q: text, source: sourceLanguage, target: targetLanguage, format: "text", ...(key ? { api_key: key } : {}) }) };
    default: throw new Error("查询服务无效。");
  }
}
async function readBoundedResponse(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get("Content-Length")) > lookupResponseLimit) throw new Error("查询结果过大，请缩小选区。");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > lookupResponseLimit) throw new Error("查询结果过大，请缩小选区。");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
export const selectionLookupTransport: LookupTransport = async (input) => {
  input.signal?.throwIfAborted();
  // Validate before IPC as well as in the host; custom requests cannot escape a provider's scope.
  lookupHttpRequest(input);
  if (isTauri()) {
    const requestId = crypto.randomUUID();
    const cancel = () => { void invoke("cancel_selection_lookup_request", { requestId }).catch(() => undefined); };
    const pending = invoke<{ status: number; body: string }>("request_selection_lookup", {
      config: input.config, text: input.text, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage, requestId
    });
    input.signal?.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted) cancel();
    try { const result = await pending; input.signal?.throwIfAborted(); return result; }
    catch (error) { input.signal?.throwIfAborted(); throw error instanceof Error ? error : new Error(String(error)); }
    finally { input.signal?.removeEventListener("abort", cancel); }
  }
  const key = input.config.provider === "libretranslate" ? sessionKeys.get(validateLookupEndpoint(input.config.endpoint ?? "")) : undefined;
  const request = lookupHttpRequest(input, key);
  const timeout = AbortSignal.timeout(15000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(request.url, { method: request.method, body: request.body,
      headers: request.body ? { "Content-Type": "application/json" } : undefined, signal,
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  } catch (error) {
    input.signal?.throwIfAborted();
    if (timeout.aborted) throw new Error("查询超时，请重试或切换服务。");
    throw new Error("无法连接查询服务。请检查网络；浏览器跨域受限时可使用桌面版。");
  }
  return { status: response.status, body: await readBoundedResponse(response, signal) };
};
