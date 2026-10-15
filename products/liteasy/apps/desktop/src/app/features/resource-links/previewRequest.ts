import { messageWithFallback } from "../../shared/i18n/i18n";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";

/** Local, bounded diagnostics. Never record paths, titles, text, bytes, or account identifiers. */
export type PreviewTrace = { requestId: number; generation: string | number; revision?: string; stage: string; duration: number; outcome: "ok" | "error" | "cancelled"; code?: string };
const traces: PreviewTrace[] = [];
let requestId = 0;
export const previewDiagnostics = () => traces.map((entry) => ({ ...entry }));
export class PreviewRequestError extends Error {
  constructor(readonly code: "timeout" | "cancelled" | "decode" | "canvas" | "unavailable", message: string) { super(message); }
}
export function previewErrorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "timeout") return messageWithFallback("preview.timeout", "读取超时，请重试。");
  if (code === "cancelled" || (error instanceof Error && error.name === "AbortError")) return messageWithFallback("preview.cancelled", "已取消读取。");
  if (error instanceof PreviewRequestError) return error.message;
  const messages: Record<string, string> = {
    unsupported_type: "此类资料暂不支持预览，请打开原文件。",
    ambiguous_provider: "此资料有多个读取入口，请重新选择来源。",
    not_found: "来源已删除或当前不可用，请重新选择资料。",
    permission_denied: "当前账号没有读取此资料的权限。",
    revision_unavailable: "引用的来源版本已不可用，请重新选择资料。",
    not_prepared: "正文尚未就绪，可以解析正文后重试。",
    scope_changed: "账号或权限已变化，请重新打开资料。",
    invalid_path: "资料地址无效，请重新选择来源。",
    revision_conflict: "来源版本已变化，请重新打开资料。",
  };
  return messages[code] ?? messageWithFallback("preview.unavailable", "预览暂不可用，请重试。");
}
export function createPreviewRequest(options: { signal?: AbortSignal; timeoutMs?: number; generation?: string | number; revision?: string } = {}) {
  const controller = new AbortController(), id = ++requestId;
  const generation = options.generation ?? getAccountSessionGeneration();
  let revision = options.revision;
  const cancel = () => controller.abort(options.signal?.reason ?? new PreviewRequestError("cancelled", messageWithFallback("preview.cancelled", "已取消读取。")));
  if (options.signal?.aborted) cancel(); else options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new PreviewRequestError("timeout", messageWithFallback("preview.timeout", "读取超时，请重试。"))), options.timeoutMs ?? 15000);
  return {
    signal: controller.signal,
    bindRevision(value?: string) { revision = value; },
    dispose() { clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); },
    async stage<T>(stage: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const start = performance.now(); let outcome: PreviewTrace["outcome"] = "ok", code: string | undefined;
      try { return await abortable(operation, controller.signal); }
      catch (error) { outcome = controller.signal.aborted ? "cancelled" : "error"; code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown"; throw error; }
      finally { traces.push({ requestId: id, generation, revision, stage, duration: Math.round(performance.now() - start), outcome, code }); if (traces.length > 200) traces.shift(); }
    },
  };
}
/** Abort is propagated to the actual operation; late values have an explicit disposal hook. */
export function abortable<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, disposeLate?: (value: T) => void): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(signal); }).then((value) => { if (signal.aborted) disposeLate?.(value); else resolve(value); }, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}
export function createPreviewQueue(concurrency = 2) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(operation: () => Promise<T>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (running >= concurrency) await new Promise<void>((resolve, reject) => {
      const resume = () => { signal.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { const index = waiting.indexOf(resume); if (index >= 0) waiting.splice(index, 1); reject(signal.reason); };
      waiting.push(resume); signal.addEventListener("abort", cancel, { once: true });
    }); else running++;
    try { signal.throwIfAborted(); return await operation(); }
    finally { const next = waiting.shift(); if (next) next(); else running--; }
  };
}
