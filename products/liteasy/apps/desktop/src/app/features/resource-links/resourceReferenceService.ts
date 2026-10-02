import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import type { AgentAsset } from "../resource-filesystem/agentAsset.types";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import { decodeReference, normalizeReferenceText, splitReference } from "./referenceText";

export type ReferenceCandidate = { path: string; title: string; detail?: string; kind?: string };
export type ReferenceDocument = { asset: AgentAsset; text: string; complete: boolean; limit: number; totalCharacters: number };
export function createResourceReferenceService(input: { scope: string; assets: AgentAssetService; catalog(): ReferenceCandidate[]; active(): boolean; subscribe?(path: string, changed: () => void): () => void }) {
  function check(signal?: AbortSignal) { signal?.throwIfAborted(); if (!input.active()) throw new Error("账号已切换，请重新选择引用。"); }
  const name = (value: string) => value.trim().replace(/\.(md|markdown|pdf|epub|mobi|canvas)$/i, "").toLocaleLowerCase();
  const known = () => [...new Map(input.catalog().filter((item) => item.path).map((item) => [item.path, item])).values()];
  let reading = 0;
  const waiting: (() => void)[] = [];
  async function read<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (reading >= 2) await new Promise<void>((resolve, reject) => {
      const resume = () => { signal?.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { const index = waiting.indexOf(resume); if (index >= 0) waiting.splice(index, 1); reject(signal?.reason); };
      waiting.push(resume); signal?.addEventListener("abort", cancel, { once: true });
    });
    else reading++;
    try { check(signal); return await operation(); }
    finally { const next = waiting.shift(); if (next) next(); else reading--; }
  }
  const service = {
    scope: input.scope,
    subscribe(path: string, changed: () => void) { return input.subscribe?.(path, changed) ?? (() => {}); },
    async search(query: string, signal?: AbortSignal): Promise<ReferenceCandidate[]> {
      check(signal);
      const local = known().filter((item) => `${item.title} ${item.detail ?? ""} ${item.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      const remote = await input.assets.search({ query, limit: 100, signal });
      check(signal);
      return [...new Map([...local, ...remote].map((item) => [item.path, item])).values()].slice(0, 100);
    },
    async resolve(raw: string, source?: string, signal?: AbortSignal): Promise<ReferenceCandidate> {
      check(signal);
      const { target } = splitReference(raw);
      if (!target && source) return read(() => input.assets.stat(source, { signal }), signal);
      if (target.startsWith("liteasy://")) return read(() => input.assets.stat(target, { signal }), signal);
      if (!target || /^[a-z][a-z0-9+.-]*:|^[\/\\]/i.test(target)) throw new Error("请选择当前文献库中的文件或有效的 Liteasy Path。");
      if (source?.startsWith("liteasy://files/")) {
        const base = parseLiteasyPath(source, input.scope);
        if (base.kind === "external-file") {
          const parts = [...base.path.split("/").slice(0, -1)];
          for (const part of decodeReference(target).replace(/\\/g, "/").split("/")) {
            if (part === "..") { if (!parts.length) throw new Error("引用不能超出挂载目录。"); parts.pop(); }
            else if (part && part !== ".") parts.push(part);
          }
          const relative = parts.join("/");
          for (const path of [...new Set([relative, /\.[^/]+$/.test(relative) ? relative : `${relative}.md`])]) {
            try { return await read(() => input.assets.stat(liteasyPath(input.scope, { kind: "external-file", mountId: base.mountId, path }), { signal }), signal); }
            catch { check(signal); }
          }
        }
      }
      const candidates = await service.search(decodeReference(target), signal);
      const exact = candidates.filter((item) => name(item.title) === name(target) || name(item.detail ?? "") === name(target) || name(decodeReference(new URL(item.path).pathname).split("/").at(-1) ?? "") === name(target));
      if (exact.length !== 1) throw new Error(exact.length ? "有多个同名文件，请使用＋选择具体文件。" : "未找到引用的文件，请使用＋搜索并选择。");
      return exact[0];
    },
    async document(path: string, limit = 12000, signal?: AbortSignal): Promise<ReferenceDocument> {
      check(signal);
      limit = Math.min(80000, Math.max(1, limit));
      const result = await read(() => input.assets.read(path, { maxCharacters: limit, signal }), signal);
      check(signal);
      return { asset: result.asset, text: normalizeReferenceText(result.text), complete: !result.truncated, limit, totalCharacters: result.totalCharacters };
    },
    async verify(document: ReferenceDocument, signal?: AbortSignal) {
      const current = await service.document(document.asset.path, document.limit, signal);
      if (current.asset.revision !== document.asset.revision || current.text !== document.text || current.totalCharacters !== document.totalCharacters) throw new Error("源文件已修改，请重新载入并选择片段。");
    },
    link(candidate: ReferenceCandidate, fragment = "") {
      const duplicates = known().filter((item) => name(item.title) === name(candidate.title));
      const title = candidate.title.replace(/\.(md|markdown)$/i, "");
      const target = duplicates.length > 1 || /[\[\]#|\n]/.test(title) ? candidate.path : title;
      const selector = fragment ? `#${fragment.replace(/[|\[\]\n]/g, encodeURIComponent)}` : "";
      return `${target}${selector}${target === title ? "" : `|${title.replace(/[\[\]|\n]/g, " ")}${selector}`}`;
    },
  };
  return service;
}
export type ResourceReferenceService = ReturnType<typeof createResourceReferenceService>;
