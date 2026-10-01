import { invoke, isTauri } from "@tauri-apps/api/core";
import { paperServiceRequest, validatePaperService, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
export type EmbeddingConfig = { endpoint: string; model: string; dimensions?: number };
export function localEmbedding(config: EmbeddingConfig) { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.endpoint).hostname); } catch { return false; } }
export function embeddingFingerprint(config: EmbeddingConfig) {
  return JSON.stringify(["multilingual-v1", validatePaperService({ provider: "embedding", endpoint: config.endpoint }).endpoint, config.model, config.dimensions]);
}
export async function semanticRequest(provider: "embedding" | "reranker", config: EmbeddingConfig, body: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const service: PaperServiceConfig = validatePaperService({ provider, endpoint: config.endpoint });
  if (!config.model.trim() || config.model.length > 200) throw new Error("请指定语义服务模型。");
  let response: Response;
  if (isTauri()) {
    const requestId = crypto.randomUUID();
    const cancel = () => { void invoke("cancel_public_document", { requestId }).catch(() => undefined); };
    const task = invoke<{ status: number; bodyBase64: string }>("request_semantic_service", { requestId, config: service, body: JSON.stringify(body) });
    signal.addEventListener("abort", cancel, { once: true });
    try { const result = await task; signal.throwIfAborted(); response = new Response(Uint8Array.from(atob(result.bodyBase64), (value) => value.charCodeAt(0)), { status: result.status }); }
    finally { signal.removeEventListener("abort", cancel); }
  } else response = await paperServiceRequest(service, `${service.endpoint}/${provider === "embedding" ? "embeddings" : "rerank"}`, { method: "POST", json: body, signal, timeoutMs: 30_000, maxResponseBytes: 8 * 1024 * 1024 });
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`语义服务返回 HTTP ${response.status}，已保留词项推荐。`);
  return response.json() as Promise<unknown>;
}
export async function embedTexts(config: EmbeddingConfig, texts: string[], signal: AbortSignal) {
  if (!texts.length || texts.length > 32 || texts.some((text) => !text.trim() || text.length > 8000)) throw new Error("向量请求需包含 1–32 个有界片段。");
  const value = await semanticRequest("embedding", config, { model: config.model, input: texts, encoding_format: "float" }, signal) as { data?: { index: number; embedding: unknown }[] };
  if (!Array.isArray(value?.data) || value.data.length !== texts.length) throw new Error("向量服务返回的条目数量无效。");
  const rows = [...value.data].sort((a, b) => a.index - b.index);
  const dimension = Array.isArray(rows[0]?.embedding) ? rows[0].embedding.length : 0;
  if (!dimension || dimension > 4096 || config.dimensions && config.dimensions !== dimension || rows.some((row, index) => row.index !== index || !Array.isArray(row.embedding) || row.embedding.length !== dimension || !row.embedding.every((n) => typeof n === "number" && Number.isFinite(n)) || !row.embedding.some((n) => n !== 0))) throw new Error("向量模型或维度与配置不符，请重新测试服务。");
  return rows.map((row) => row.embedding as number[]);
}
export async function rerankTexts(config: EmbeddingConfig, query: string, documents: string[], signal: AbortSignal) {
  const value = await semanticRequest("reranker", config, { model: config.model, query: query.slice(0, 8000), documents: documents.slice(0, 30).map((text) => text.slice(0, 8000)), top_n: Math.min(30, documents.length) }, signal) as { results?: { index: number; relevance_score: number }[] };
  if (!Array.isArray(value?.results) || value.results.some((row) => !Number.isInteger(row.index) || row.index < 0 || row.index >= documents.length || !Number.isFinite(row.relevance_score) || row.relevance_score < 0 || row.relevance_score > 1) || new Set(value.results.map((row) => row.index)).size !== value.results.length) throw new Error("重排服务返回的排名无效。");
  return value.results;
}
