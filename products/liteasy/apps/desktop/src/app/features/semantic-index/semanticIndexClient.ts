import { invoke, isTauri } from "@tauri-apps/api/core";
import { bm25, cosine, terms } from "../../../../../../packages/recommendation-core/index.mjs";
export type IndexRecord = { id: string; path: string; revision: string; text: string; tokens: string; vector?: number[]; payload?: unknown };
export type IndexHit = { id: string; path: string; payload?: unknown; lexical?: number; semantic?: number };
export async function contentFingerprint(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
// Browser preview uses a bounded session cache; native Windows uses persistent SQLite.
const preview = new Map<string, Map<string, IndexRecord>>();
export function createSemanticIndex(input: { scope: string; workspace: string; model: string; active(): boolean }) {
  const scopeKey = JSON.stringify([input.scope, input.workspace, input.model]);
  const check = (signal?: AbortSignal) => { signal?.throwIfAborted(); if (!input.active()) throw new Error("检索工作区已切换。"); };
  async function dispatch<T>(action: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    check(signal);
    if (isTauri()) {
      const requestId = crypto.randomUUID();
      const cancel = () => { void invoke("semantic_index_cancel", { requestId }).catch(() => undefined); };
      const request = invoke<T>("semantic_index_dispatch", { requestId, input: { scope: input.scope, workspace: input.workspace, model: input.model, action, ...args } });
      signal?.addEventListener("abort", cancel, { once: true });
      try { const result = await request; check(signal); return result; }
      finally { signal?.removeEventListener("abort", cancel); }
    }
    let rows = preview.get(scopeKey); if (!rows) { rows = new Map(); preview.set(scopeKey, rows); if (preview.size > 8) preview.delete(preview.keys().next().value!); }
    let result: unknown;
    if (action === "lookup") result = (args.ids as string[]).flatMap((id) => rows!.has(id) ? [rows!.get(id)!] : []);
    else if (action === "upsert") {
      for (const record of args.records as IndexRecord[]) { for (const [key, old] of rows) if (old.path === record.path && old.revision !== record.revision) rows.delete(key); rows.set(record.id, record); }
      while (rows.size > 500) rows.delete(rows.keys().next().value!);
      result = { ok: true };
    } else if (action === "clear") { rows.clear(); result = { ok: true }; }
    else if (action === "delete") { for (const [key, row] of rows) if ((args.ids as string[]).includes(row.path)) rows.delete(key); result = { ok: true }; }
    else {
      const values = [...rows.values()], scores = bm25(String(args.text || ""), values.map((row) => row.text));
      result = values.map((row, i) => ({ id: row.id, path: row.path, payload: row.payload, lexical: scores[i], semantic: cosine(args.vector as number[] | undefined, row.vector) }))
        .filter((row) => row.lexical > 0 || row.semantic > 0).sort((a, b) => b.semantic + b.lexical - a.semantic - a.lexical).slice(0, Number(args.limit ?? 100));
    }
    check(signal); return result as T;
  }
  return {
    lookup: (ids: string[], signal?: AbortSignal) => dispatch<IndexRecord[]>("lookup", { ids }, signal),
    upsert: (records: IndexRecord[], signal?: AbortSignal) => dispatch("upsert", { records }, signal),
    search: (text: string, vector?: number[], signal?: AbortSignal) => dispatch<IndexHit[]>("search", { text: terms(text).join(" "), vector, limit: 100 }, signal),
    remove: (paths: string[], signal?: AbortSignal) => dispatch("delete", { ids: paths }, signal),
    clear: () => dispatch("clear"),
  };
}
export type SemanticIndex = ReturnType<typeof createSemanticIndex>;

export async function clearSemanticScope(scope: string) {
  if (isTauri()) await invoke("semantic_index_clear_scope", { scope });
  else for (const key of preview.keys()) if ((JSON.parse(key) as string[])[0] === scope) preview.delete(key);
}
