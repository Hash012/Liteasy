import { invoke, isTauri } from "@tauri-apps/api/core";
export type PaperServiceConfig = { provider: "crossref" | "openalex" | "semantic-scholar" | "mineru"; endpoint: string };
const keys = new Map<string, string>();
export function validatePaperService(config: PaperServiceConfig) {
  const url = new URL(config.endpoint);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error("服务地址须使用 HTTPS，不能包含密钥；本机可用 HTTP。");
  return { ...config, endpoint: url.toString().replace(/\/+$/, "") };
}
function scope(config: PaperServiceConfig) { const valid = validatePaperService(config); return `${valid.provider}:${valid.endpoint}`; }
export async function savePaperServiceKey(config: PaperServiceConfig, apiKey: string) {
  validatePaperService(config);
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error("API key 无效。");
  if (isTauri()) await invoke("save_paper_service_key", { config, apiKey }); else keys.set(scope(config), apiKey.trim());
}
export async function hasPaperServiceKey(config: PaperServiceConfig): Promise<boolean> { return isTauri() ? invoke("has_paper_service_key", { config }) : keys.has(scope(config)); }
export async function deletePaperServiceKey(config: PaperServiceConfig) { if (isTauri()) await invoke("delete_paper_service_key", { config }); else keys.delete(scope(config)); }
export function encodeBytes(bytes: Uint8Array) { let text = ""; for (let i=0; i<bytes.length; i+=32768) text += String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(text); }
export async function paperServiceRequest(configInput: PaperServiceConfig, url: string, options: { method?: "GET" | "POST" | "PUT"; body?: Uint8Array; json?: unknown; authenticate?: boolean } = {}): Promise<Response> {
  const config = validatePaperService(configInput);
  const target = new URL(url);
  const authenticate = options.authenticate !== false;
  if (authenticate && (target.origin !== new URL(config.endpoint).origin || !target.pathname.startsWith(new URL(config.endpoint).pathname.replace(/\/$/, "")))) throw new Error("禁止向其他服务发送密钥。");
  const bytes = options.body ?? (options.json === undefined ? undefined : new TextEncoder().encode(JSON.stringify(options.json)));
  const contentType = options.json === undefined ? undefined : "application/json";
  if (isTauri()) {
    const result = await invoke<{ status: number; bodyBase64: string }>("request_paper_service", { config, url, method: options.method ?? "GET", bodyBase64: bytes ? encodeBytes(bytes) : null, contentType: contentType ?? null, authenticate });
    return new Response(Uint8Array.from(atob(result.bodyBase64), (char) => char.charCodeAt(0)), { status: result.status });
  }
  const key = authenticate ? keys.get(scope(config)) : undefined;
  const headers: Record<string,string> = contentType ? { "Content-Type": contentType } : {};
  if (key) {
    if (config.provider === "openalex") target.searchParams.set("api_key", key);
    else if (config.provider === "semantic-scholar") headers["x-api-key"] = key;
    else headers[config.provider === "crossref" ? "Crossref-Plus-API-Token" : "Authorization"] = `Bearer ${key}`;
  }
  return fetch(target, { method: options.method ?? "GET", headers, body: bytes as BodyInit | undefined, signal: AbortSignal.timeout(120_000), redirect: "error" });
}
