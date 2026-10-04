import { compileSearchQuery } from "../search/searchQuery";
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
  const start = positions.length ? Math.max(0, Math.min(...positions) - 65) : 0;
  return `${start ? "…" : ""}${text.slice(start, start + 260).trim()}${start + 260 < text.length ? "…" : ""}`;
}
const manifestPath = "global-search:manifest";
const blankCoverage = (): SearchCoverage => ({ indexed: 0, partial: 0, metadata: 0, failed: 0, limited: false, details: [] });
function documentRecords(document: SearchDocument, capacity: number) {
  const records: IndexRecord[] = [];
  for (const section of document.sections) {
    // 4K chars/overlap bound IPC bytes and allow phrases across chunk boundaries.
    for (let offset = 0; offset < section.text.length; offset += 2800) {
      if (records.length >= capacity) return { records, limited: true };
      const text = section.text.slice(offset, offset + 4000);
      const line = section.group === "metadata" ? undefined
        : (section.locator.line ?? 1) + (section.text.slice(0, offset).match(/\n/g)?.length ?? 0);
      // Titles live in their own metadata section; repeating them here matches every body chunk.
      records.push({ id: `${document.id}:${section.key}:${offset}`, path: document.id, revision: document.revision,
        text, tokens: "", payload: { ...section.locator, ...(line === undefined ? {} : { line }), documentId: document.id,
          metadata: section.metadata ?? document.metadata, revision: document.revision, title: document.title, group: section.group, text } });
      if (offset + 4000 >= section.text.length) break;
    }
  }
  return { records, limited: false };
}
/** Rebuildable lexical cache. The current authorized corpus and live revisions remain authoritative. */
export function createGlobalSearchService(input: { index: SemanticIndex; source: SearchSource; active(): boolean; capacity?: number }) {
  let current = new Map<string, SearchDocument>(), admitted = new Map<string, number>(), coverage = blankCoverage();
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
      current = new Map(); admitted = new Map(); coverage = blankCoverage();
      const corpus = await input.source.collect(signal, progress); check(signal);
      const saved = await input.index.lookup([manifestPath], signal);
      const before = (saved[0]?.payload ?? {}) as Record<string, string>;
      const after: Record<string, string> = Object.create(null);
      const next = new Map<string, SearchDocument>();
      const changed: Array<{ document: SearchDocument; count: number }> = [];
      let count = 0;
      for (const document of corpus.documents) {
        check(signal);
        const { records, limited } = documentRecords(document, (input.capacity ?? 48000) - count);
        count += records.length; coverage.limited ||= limited;
        if (limited && !records.length) break;
        coverage[limited && document.coverage === "indexed" ? "partial" : document.coverage]++;
        if (document.detail && coverage.details.length < 100) coverage.details.push({ title: document.title, detail: document.detail });
        if (!records.length) continue;
        // Display titles, groups and locators can change without changing the
        // source bytes. Cache the complete normalized records, not just revision.
        after[document.id] = await contentFingerprint(JSON.stringify(records));
        if (before[document.id] !== after[document.id]) {
          changed.push({ document, count: records.length });
        }
        check(signal); next.set(document.id, document); admitted.set(document.id, records.length);
        if (coverage.limited) break;
      }
      // Prune against the actual bounded selection, including changed documents
      // whose old chunks may be larger. Adding first can evict unchanged sources.
      // Remove the manifest before mutations: an interrupted pass must rebuild,
      // including any newly written rows the old manifest did not know about.
      if (!saved.length) await input.index.clear();
      const removed = [manifestPath, ...new Set([
        ...Object.keys(before).filter((id) => before[id] !== after[id]),
        ...changed.map(({ document }) => document.id)
      ])];
      for (let i = 0; i < removed.length; i += 200) await input.index.remove(removed.slice(i, i + 200), signal);
      for (const entry of changed) {
        check(signal);
        // Recreate one document at a time instead of retaining every chunk payload.
        const { records } = documentRecords(entry.document, entry.count);
        for (let offset = 0; offset < records.length; offset += 32) await input.index.upsert(records.slice(offset, offset + 32), signal);
      }
      const payload = JSON.stringify(after);
      // Keep manifest bounded; very large corpora safely reindex instead of relying on truncated state.
      if (new TextEncoder().encode(payload).length < 60000) await input.index.upsert([{ id: manifestPath, path: manifestPath, revision: await contentFingerprint(payload), text: "", tokens: "", payload: after }], signal);
      check(signal); current = next; coverage.limited ||= corpus.limited;
      return coverage;
    },
    async search(query: string, group: SearchGroup | undefined, offset: number, signal: AbortSignal) {
      check(signal); const compiled = compileSearchQuery(query);
      if (compiled.error) throw new Error(compiled.error);
      const clauses = compiled.terms;
      if (!query.trim() || !compiled.hasText && !compiled.advanced) return { hits: [] as SearchHit[], nextOffset: null as number | null, coverage };
      let result: { hits: IndexRecord[]; nextOffset: number | null };
      if (compiled.advanced) {
        // Scan only admitted chunks, yielding between bounded batches. RE2 guarantees linear matching.
        const rows: IndexRecord[] = []; let scanned = 0, matched = 0, more = false;
        outer: for (const document of current.values()) {
          const records = documentRecords(document, admitted.get(document.id) ?? 0).records;
          let emitted = false;
          for (const row of records) {
            if (++scanned % 64 === 0) { await new Promise((resolve) => setTimeout(resolve, 0)); check(signal); }
            const payload = row.payload as SearchHit;
            if (group && payload.group !== group) continue;
            if (!compiled.hasText && (emitted || !group && payload.group !== "metadata")) continue;
            if (!compiled.matches(payload.text, payload.metadata)) continue;
            emitted = true;
            if (matched++ < offset) continue;
            if (rows.length === 20) { more = true; break outer; }
            rows.push(row);
          }
        }
        result = { hits: rows, nextOffset: more ? offset + 20 : null };
      } else result = await input.index.literalQuery(clauses, { group, offset, limit: 20 }, signal);
      const hits: SearchHit[] = [];
      const verified = new Map<string, boolean>();
      for (const row of result.hits) {
        check(signal); const document = current.get(row.path);
        if (!document || row.revision !== document.revision) continue;
        const hit: SearchHit = { ...(row.payload as Omit<SearchHit, "id" | "snippet">), id: row.id,
          snippet: searchSnippet((row.payload as { text: string }).text, compiled.ranges((row.payload as { text: string }).text).map((range) => (row.payload as { text: string }).text.slice(range.start, range.end))) };
        // A filename match opens the file, not a fabricated location in its body.
        if (hit.group !== "metadata") {
          const match = compiled.ranges(hit.text)[0];
          const at = match?.start ?? 0;
          hit.line = (hit.line ?? 1) + (hit.text.slice(0, at).match(/\n/g)?.length ?? 0);
          if (match) hit.matchedText = hit.text.slice(match.start, match.end);
          if (!hit.quote && match) hit.quote = hit.text.slice(match.start, match.end);
        }
        if (!verified.has(row.path)) verified.set(row.path, await input.source.verify(hit, signal));
        if (verified.get(row.path)) hits.push(hit);
        else { current.delete(row.path); await removeRejectedDocument(row.path, signal); }
      }
      check(signal); return { hits, nextOffset: result.nextOffset, coverage };
    },
    tags() { return [...new Set([...current.values()].flatMap((document) => [...(document.metadata?.tags ?? []), ...document.sections.flatMap((section) => section.metadata?.tags ?? [])]))].sort(); },
    async verify(hit: SearchHit, signal: AbortSignal) {
      check(signal);
      if (!current.has(hit.documentId) || !(await input.source.verify(hit, signal))) throw new Error("来源已修改、删除或不再授权，请刷新搜索。");
      check(signal);
    },
  };
}
