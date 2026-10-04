import { compileSearchQuery } from "../search/searchQuery";
import { contentFingerprint, type SemanticIndex, type IndexRecord } from "../semantic-index/semanticIndexClient";
import type { SearchCoverage, SearchDocument, SearchGroup, SearchHit, SearchSource } from "./globalSearch.types";
import { mapSearchBatch } from "./searchBatches";
import { readSearchManifest, writeSearchManifest, searchManifestPath as manifestPath } from "./searchManifest";

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
const blankCoverage = (): SearchCoverage => ({ indexed: 0, partial: 0, metadata: 0, failed: 0, limited: false, details: [] });
function documentRecords(document: SearchDocument, capacity: number) {
  const records: IndexRecord[] = [];
  for (const section of document.sections) {
    let line = section.locator.line ?? 1, previousOffset = 0;
    // 4K chars/overlap bound IPC bytes and allow phrases across chunk boundaries.
    for (let offset = 0; offset < section.text.length; offset += 2800) {
      if (records.length >= capacity) return { records, limited: true };
      const text = section.text.slice(offset, offset + 4000);
      // Count each newline once, even in a long book; never rescan every prefix.
      line += section.text.slice(previousOffset, offset).match(/\n/g)?.length ?? 0;
      previousOffset = offset;
      // Titles live in their own metadata section; repeating them here matches every body chunk.
      records.push({ id: `${document.id}:${section.key}:${offset}`, path: document.id, revision: document.revision,
        text, tokens: "", payload: { ...section.locator, ...(section.group === "metadata" ? {} : { line }), documentId: document.id,
          metadata: section.metadata ?? document.metadata, revision: document.revision, title: document.title, group: section.group, text } });
      if (offset + 4000 >= section.text.length) break;
    }
  }
  return { records, limited: false };
}
/** Rebuildable lexical cache. The current authorized corpus and live revisions remain authoritative. */
export function createGlobalSearchService(input: { index: SemanticIndex; source: SearchSource; active(): boolean; capacity?: number }) {
  type DocumentVersion = Pick<SearchDocument, "id" | "revision">;
  let current = new Map<string, DocumentVersion>(), chunks = new Map<string, IndexRecord[]>(), coverage = blankCoverage();
  let tags: string[] = [];
  let mutations = Promise.resolve(), generation = 0;
  function mutate<T>(signal: AbortSignal, work: () => Promise<T>) {
    const result = mutations.catch(() => {}).then(() => { check(signal); return work(); });
    mutations = result.then(() => {}, () => {});
    return result;
  }
  const updateTags = () => {
    const values = new Set<string>(), seen = new Set<SearchHit["metadata"]>();
    for (const rows of chunks.values()) for (const row of rows) {
      const metadata = (row.payload as SearchHit).metadata;
      if (seen.has(metadata)) continue;
      seen.add(metadata); for (const tag of metadata?.tags ?? []) values.add(tag);
    }
    tags = [...values].sort();
  };
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); if (!input.active()) throw new Error("工作区已切换，请重新搜索。"); };
  async function removeRejectedDocument(path: string, signal: AbortSignal) {
    const saved = await readSearchManifest(input.index, signal);
    const after = { ...saved.entries };
    if (Object.prototype.hasOwnProperty.call(after, path)) {
      delete after[path];
      await input.index.remove([manifestPath, path], signal);
      await writeSearchManifest(input.index, after, signal);
    } else {
      await input.index.remove([path], signal);
    }
  }
  return {
    async refresh(signal: AbortSignal, progress: (count: number) => void) {
      return mutate(signal, async () => {
        check(signal);
        generation++;
        // Drop the admissible set first; an interrupted refresh must never serve old snippets.
        current = new Map(); chunks = new Map(); tags = []; coverage = blankCoverage();
        const corpus = await input.source.collect(signal, progress); check(signal);
        const saved = await readSearchManifest(input.index, signal);
        const before = saved.entries;
        const after: Record<string, string> = Object.create(null);
        const next = new Map<string, DocumentVersion>();
        const nextChunks = new Map<string, IndexRecord[]>();
        const changed: string[] = [];
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
            changed.push(document.id);
          }
          check(signal); next.set(document.id, { id: document.id, revision: document.revision }); nextChunks.set(document.id, records);
          if (coverage.limited) break;
        }
        // Prune against the actual bounded selection, including changed documents
        // whose old chunks may be larger. Adding first can evict unchanged sources.
        // Remove the manifest before mutations: an interrupted pass must rebuild,
        // including any newly written rows the old manifest did not know about.
        if (!saved.valid) await input.index.clear();
        const removed = [manifestPath, ...new Set([
          ...Object.keys(before).filter((id) => before[id] !== after[id]),
          ...changed
        ])];
        for (let i = 0; i < removed.length; i += 200) await input.index.remove(removed.slice(i, i + 200), signal);
        let pending: IndexRecord[] = [];
        for (const id of changed) {
          for (const row of nextChunks.get(id)!) {
            pending.push(row);
            if (pending.length === 32) { check(signal); await input.index.upsert(pending, signal); pending = []; }
          }
        }
        if (pending.length) { check(signal); await input.index.upsert(pending, signal); }
        await writeSearchManifest(input.index, after, signal);
        check(signal); current = next; chunks = nextChunks; coverage.limited ||= corpus.limited;
        updateTags();
        return coverage;
      });
    },
    async search(query: string, group: SearchGroup | undefined, offset: number, signal: AbortSignal) {
      check(signal); const compiled = compileSearchQuery(query);
      const searchGeneration = generation;
      const checkSearch = () => { check(signal); if (searchGeneration !== generation) throw new Error("索引已更新，请重新搜索。"); };
      if (compiled.error) throw new Error(compiled.error);
      const clauses = compiled.terms;
      if (!query.trim() || !compiled.hasText && !compiled.advanced) return { hits: [] as SearchHit[], nextOffset: null as number | null, coverage };
      let result: { hits: IndexRecord[]; nextOffset: number | null };
      if (compiled.advanced) {
        // Scan only admitted chunks, yielding between bounded batches. RE2 guarantees linear matching.
        const rows: IndexRecord[] = []; let scanned = 0, matched = 0, more = false, yieldedAt = performance.now();
        const allowed = new Map<SearchHit["metadata"], boolean>();
        outer: for (const document of current.values()) {
          const records = chunks.get(document.id) ?? [];
          let emitted = false;
          for (const row of records) {
            if (++scanned % 16 === 0 && performance.now() - yieldedAt >= 8) {
              await new Promise((resolve) => setTimeout(resolve, 0)); check(signal); yieldedAt = performance.now();
            }
            const payload = row.payload as SearchHit;
            if (group && payload.group !== group) continue;
            if (!compiled.hasText && (emitted || !group && payload.group !== "metadata")) continue;
            if (!allowed.has(payload.metadata)) allowed.set(payload.metadata, compiled.metadata(payload.metadata));
            if (!allowed.get(payload.metadata) || !compiled.textMatches(payload.text)) continue;
            emitted = true;
            if (matched++ < offset) continue;
            if (rows.length === 20) { more = true; break outer; }
            rows.push(row);
          }
        }
        result = { hits: rows, nextOffset: more ? offset + 20 : null };
      } else result = await input.index.literalQuery(clauses, { group, offset, limit: 20 }, signal);
      const candidates: SearchHit[] = [];
      for (const row of result.hits) {
        check(signal); const document = current.get(row.path);
        if (!document || row.revision !== document.revision) continue;
        const payload = row.payload as Omit<SearchHit, "id" | "snippet">;
        const ranges = compiled.ranges(payload.text);
        const hit: SearchHit = { ...payload, id: row.id,
          snippet: searchSnippet(payload.text, ranges.map((range) => payload.text.slice(range.start, range.end))) };
        // A filename match opens the file, not a fabricated location in its body.
        if (hit.group !== "metadata") {
          const match = ranges[0];
          const at = match?.start ?? 0;
          hit.line = (hit.line ?? 1) + (hit.text.slice(0, at).match(/\n/g)?.length ?? 0);
          if (match) hit.matchedText = hit.text.slice(match.start, match.end);
          if (!hit.quote && match) hit.quote = hit.text.slice(match.start, match.end);
        }
        candidates.push(hit);
      }
      const documents = [...new Map(candidates.map((hit) => [hit.documentId, hit])).values()];
      const valid = input.source.verifyMany ? await input.source.verifyMany(documents, signal)
        : await mapSearchBatch(documents, signal, (hit) => input.source.verify(hit, signal));
      checkSearch();
      const verified = new Map(documents.map((hit, i) => [hit.documentId, valid[i] === true]));
      if (valid.some((value) => !value)) await mutate(signal, async () => {
        checkSearch();
        for (const hit of documents) if (!verified.get(hit.documentId)) {
          current.delete(hit.documentId); chunks.delete(hit.documentId); await removeRejectedDocument(hit.documentId, signal);
        }
        updateTags();
      });
      const hits = candidates.filter((hit) => verified.get(hit.documentId));
      checkSearch(); return { hits, nextOffset: result.nextOffset, coverage };
    },
    tags() { return tags; },
    async verify(hit: SearchHit, signal: AbortSignal) {
      check(signal);
      if (!current.has(hit.documentId) || !(await input.source.verify(hit, signal))) throw new Error("来源已修改、删除或不再授权，请刷新搜索。");
      check(signal);
    },
  };
}
