import type { AssistantComposerSuggestion } from "../assistant/assistant.types";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";
import { abortable } from "./previewRequest";

/** Development-only bounded event stream; keys are hashed, content is never recorded. */
let requestSequence = 0;
const events: { event: string; resourceKey: string; at: number; value?: number; requestId?: number }[] = [];
export function tracePreview(event: string, key: string, value?: number, requestId?: number) {
  if (!import.meta.env.DEV) return;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  events.push({ event, resourceKey: (hash >>> 0).toString(16), at: performance.now(), value, requestId });
  if (events.length > 2000) events.shift();
}
export const resourcePreviewDiagnostics = () => events.map(event => ({ ...event }));
export function assetPreviewKey(asset: AssistantComposerSuggestion, representation: string, fallback = "") {
  const refs = asset.token?.contextRefs?.flatMap(ref => "revision" in ref ? [ref.revision] : []) ?? [];
  return JSON.stringify([getAccountSessionGeneration(), asset.scopeId ?? fallback, asset.resourcePath ?? asset.id,
    asset.resourceRevision ?? (refs.length ? refs : asset.updatedAt ?? fallback), representation]);
}

/** Ref-counted in-flight reads, TTL and byte budget. Last consumer aborts unfinished I/O. */
export function createPreviewResourceCache<T>(maxEntries: number, maxBytes: number, size: (value: T) => number, ttl = 60_000, dispose?: (value: T) => void) {
  type Entry = { requestId: number; controller: AbortController; promise: Promise<T>; value?: T; refs: number; bytes: number; at: number; settled: boolean; timer?: ReturnType<typeof setTimeout> };
  const entries = new Map<string, Entry>();
  function remove(key: string, entry: Entry) {
    if (entries.get(key) === entry) entries.delete(key);
    clearTimeout(entry.timer); entry.controller.abort();
    if (entry.value !== undefined) dispose?.(entry.value);
  }
  function prune() {
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of entries) {
      if (entry.refs || (entries.size <= maxEntries && bytes <= maxBytes && Date.now() - entry.at < ttl)) continue;
      bytes -= entry.bytes; remove(key, entry);
    }
  }
  return {
    acquire(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
      signal?.throwIfAborted(); prune();
      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { requestId: ++requestSequence, controller, refs: 0, bytes: 0, at: Date.now(), settled: false, promise: Promise.resolve(undefined as T) };
        const captured = entry;
        tracePreview("request.start", key, undefined, captured.requestId);
        entry.promise = abortable(load, controller.signal, dispose).then(value => {
          captured.settled = true; captured.value = value; captured.bytes = size(value); captured.at = Date.now();
          tracePreview("request.ready", key, captured.bytes, captured.requestId); prune(); return value;
        }).catch(error => { if (entries.get(key) === captured) entries.delete(key); throw error; });
        entries.set(key, entry);
      } else { entries.delete(key); entries.set(key, entry); tracePreview("request.reuse", key, undefined, entry.requestId); }
      clearTimeout(entry.timer); entry.refs++;
      const captured = entry;
      let released = false;
      const release = () => {
        if (released) return; released = true;
        signal?.removeEventListener("abort", release);
        captured.refs--;
        if (!captured.refs && !captured.settled) { tracePreview("request.cancel", key, undefined, captured.requestId); remove(key, captured); }
        if (!captured.refs && captured.settled) captured.timer = setTimeout(() => { if (!captured.refs) remove(key, captured); }, ttl);
        prune();
      };
      signal?.addEventListener("abort", release, { once: true });
      return { promise: signal ? abortable(() => captured.promise, signal) : captured.promise, release };
    },
    clear() { for (const [key, entry] of entries) if (!entry.refs) remove(key, entry); },
  };
}
