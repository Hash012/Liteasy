import { contentFingerprint, type SemanticIndex, type IndexRecord } from "../semantic-index/semanticIndexClient";
import type { SearchCoverage, SearchDocument, SearchGroup, SearchHit, SearchSource } from "./globalSearch.types";

export function parseSearchQuery(query: string) {
  if (query.length > 2048) throw new Error("检索内容过长，请缩短到 2048 字符以内。");
  const clauses: string[] = []; let token = "", quoted = false;
  for (const char of query.trim()) {
    if (char === '"' || char === "“" || char === "”") { quoted = !quoted; if (!quoted && token.trim()) { clauses.push(token.trim()); token = ""; } }
    else if (/\s/u.test(char) && !quoted) { if (token) clauses.push(token); token = ""; }
    else token += char;
  }
  if (quoted) throw new Error("请补上短语右侧的引号。");
  if (token) clauses.push(token);
  if (clauses.length > 16) throw new Error("一次最多检索 16 个词或短语。");
  return [...new Set(clauses.map((part) => part.toLowerCase()))];
}
export function searchSnippet(text: string, clauses: string[]) {
  const positions = clauses.map((clause) => text.toLowerCase().indexOf(clause)).filter((i) => i >= 0);
  const start = Math.max(0, Math.min(...positions, text.length) - 65);
  return `${start ? "…" : ""}${text.slice(start, start + 260).trim()}${start + 260 < text.length ? "…" : ""}`;
}
const manifestPath = "global-search:manifest";
const blankCoverage = (): SearchCoverage => ({ indexed: 0, partial: 0, metadata: 0, failed: 0, limited: false, details: [] });
/** Rebuildable lexical cache. The current authorized corpus and live revisions remain authoritative. */
export function createGlobalSearchService(input: { index: SemanticIndex; source: SearchSource; active(): boolean; capacity?: number }) {
  let current = new Map<string, SearchDocument>(), coverage = blankCoverage();
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); if (!input.active()) throw new Error("工作区已切换，请重新搜索。"); };
  async function removeRejectedDocument(path: string, signal: AbortSignal) {
    const saved = await input.index.lookup([manifestPath], signal);
    const after = { ...((saved[0]?.payload ?? {}) as Record<string, string>) };
    if (Object.prototype.hasOwnProperty.call(after, path)) {
      delete after[path];
      const payload = JSON.stringify(after);
      // Invalidate the persisted shortcut before deleting rows. If interrupted,
      // the next refresh rebuilds this source even when its revision is unchanged.
      await input.index.upsert([{ id: manifestPath, path: manifestPath,
        revision: await contentFingerprint(payload), text: "", tokens: "", payload: after }], signal);
    }
    await input.index.remove([path], signal);
  }
  return {
    async refresh(signal: AbortSignal, progress: (count: number) => void) {
      check(signal);
      // Drop the admissible set first; an interrupted refresh must never serve old snippets.
      current = new Map(); coverage = blankCoverage();
      const corpus = await input.source.collect(signal, progress); check(signal);
      const saved = await input.index.lookup([manifestPath], signal);
      const before = (saved[0]?.payload ?? {}) as Record<string, string>;
      const after: Record<string, string> = Object.create(null);
      const next = new Map<string, SearchDocument>();
      let count = 0;
      for (const document of corpus.documents) {
        check(signal);
        const records: IndexRecord[] = [];
        for (const section of document.sections) {
          // 4K chars/overlap bound IPC bytes and allow phrases across chunk boundaries.
          for (let offset = 0; offset < section.text.length; offset += 2800) {
            if (count >= (input.capacity ?? 48000)) { coverage.limited = true; break; }
            const text = section.text.slice(offset, offset + 4000);
            const line = (section.locator.line ?? 1) + (section.text.slice(0, offset).match(/\n/g)?.length ?? 0);
            records.push({ id: `${document.id}:${section.key}:${offset}`, path: document.id, revision: document.revision,
              text: `${document.title}\n${text}`, tokens: "", payload: { ...section.locator, line, documentId: document.id,
                revision: document.revision, title: document.title, group: section.group, text } });
            count++;
            if (offset + 4000 >= section.text.length) break;
          }
        }
        coverage[document.coverage]++;
        if (document.detail && coverage.details.length < 100) coverage.details.push({ title: document.title, detail: document.detail });
        if (!records.length) continue;
        // Display titles, groups and locators can change without changing the
        // source bytes. Cache the complete normalized records, not just revision.
        after[document.id] = await contentFingerprint(JSON.stringify(records));
        if (before[document.id] !== after[document.id]) {
          await input.index.remove([document.id], signal);
          for (let offset = 0; offset < records.length; offset += 32) await input.index.upsert(records.slice(offset, offset + 32), signal);
        }
        check(signal); next.set(document.id, document);
        if (coverage.limited) break;
      }
      const removed = Object.keys(before).filter((id) => !after[id]);
      for (let i = 0; i < removed.length; i += 200) await input.index.remove(removed.slice(i, i + 200), signal);
      const payload = JSON.stringify(after);
      // Keep manifest bounded; very large corpora safely reindex instead of relying on truncated state.
      if (new TextEncoder().encode(payload).length < 60000) await input.index.upsert([{ id: manifestPath, path: manifestPath, revision: await contentFingerprint(payload), text: "", tokens: "", payload: after }], signal);
      check(signal); current = next; coverage.limited ||= corpus.limited;
      return coverage;
    },
    async search(query: string, group: SearchGroup | undefined, offset: number, signal: AbortSignal) {
      check(signal); const clauses = parseSearchQuery(query);
      if (!clauses.length) return { hits: [] as SearchHit[], nextOffset: null as number | null, coverage };
      const result = await input.index.literalQuery(clauses, { group, offset, limit: 20 }, signal);
      const hits: SearchHit[] = [];
      const verified = new Map<string, boolean>();
      for (const row of result.hits) {
        check(signal); const document = current.get(row.path);
        if (!document || row.revision !== document.revision) continue;
        const hit = { ...(row.payload as Omit<SearchHit, "id" | "snippet">), id: row.id,
          snippet: searchSnippet((row.payload as { text: string }).text, clauses) };
        const at = clauses.map((clause) => hit.text.toLowerCase().indexOf(clause)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
        hit.line = (hit.line ?? 1) + (hit.text.slice(0, at).match(/\n/g)?.length ?? 0);
        if (!hit.quote) hit.quote = hit.text.slice(at, at + (clauses.find((clause) => hit.text.toLowerCase().indexOf(clause) === at)?.length ?? 80));
        if (!verified.has(row.path)) verified.set(row.path, await input.source.verify(hit, signal));
        if (verified.get(row.path)) hits.push(hit);
        else { current.delete(row.path); await removeRejectedDocument(row.path, signal); }
      }
      check(signal); return { hits, nextOffset: result.nextOffset, coverage };
    },
    async verify(hit: SearchHit, signal: AbortSignal) {
      check(signal);
      if (!current.has(hit.documentId) || !(await input.source.verify(hit, signal))) throw new Error("来源已修改、删除或不再授权，请刷新搜索。");
      check(signal);
    },
  };
}
