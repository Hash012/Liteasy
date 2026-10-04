import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createSemanticIndex } from "../app/features/semantic-index/semanticIndexClient";
import { createGlobalSearchService, parseSearchQuery } from "../app/features/global-search/globalSearchService";
import type { SearchDocument, SearchSource } from "../app/features/global-search/globalSearch.types";
import { createWorkspaceSearchSource } from "../app/features/global-search/workspaceSearchSource";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createNoteFileService } from "../app/features/note-files/noteFileService";
import { refOf } from "../app/features/objects/object.types";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
const signal = () => new AbortController().signal;
function fixture(capacity?: number) {
  let active = true;
  let documents: SearchDocument[] = [];
  const source: SearchSource = { collect: async () => ({ documents, limited: false }), verify: async (hit) => documents.some((d) => d.id === hit.documentId && d.revision === hit.revision) };
  const index = createSemanticIndex({ scope: crypto.randomUUID(), workspace: "test", model: "literal", active: () => active });
  const service = createGlobalSearchService({ index, source, active: () => active, capacity });
  return { service, index, source, setDocuments(value: SearchDocument[]) { documents = value; }, switchScope() { active = false; } };
}
function document(id: string, text: string, revision = "1"): SearchDocument { return { id, title: `Note ${id}`, revision, coverage: "indexed", sections: [{ key: "body", group: "note", text, locator: { path: `liteasy://objects/${id}?scope=test`, line: 1 } }] }; }
test("literal phrases and all terms filter before pagination, without embedding", async () => {
  const f = fixture(); f.setDocuments(Array.from({ length: 45 }, (_, i) => document(`${i}`.padStart(3, "0"), `研究 Concurrent Transactions alpha ${i}`)));
  await f.service.refresh(signal(), () => {});
  expect(parseSearchQuery('研究 "Concurrent Transactions"')).toEqual(["研究", "concurrent transactions"]);
  const first = await f.service.search('研究 "concurrent transactions"', "note", 0, signal());
  const second = await f.service.search('研究 "concurrent transactions"', "note", first.nextOffset!, signal());
  expect(first.hits).toHaveLength(20); expect(second.hits).toHaveLength(20);
  expect(new Set([...first.hits, ...second.hits].map((hit) => hit.id)).size).toBe(40);
  expect((await f.service.search('"transactions concurrent"', undefined, 0, signal())).hits).toEqual([]);
  expect((await f.service.search("alpha", "annotation", 0, signal())).hits).toEqual([]);
});
test("source revision changes, deletions and scope switch cannot leak stale snippets or open receipts", async () => {
  const f = fixture(); f.setDocuments([document("n", "obsolete secret")]); await f.service.refresh(signal(), () => {});
  const old = (await f.service.search("secret", undefined, 0, signal())).hits[0];
  f.setDocuments([document("n", "new body", "2")]);
  expect((await f.service.search("secret", undefined, 0, signal())).hits).toEqual([]);
  await expect(f.service.verify(old, signal())).rejects.toThrow("来源已修改");
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search("new", undefined, 0, signal())).hits).toHaveLength(1);
  f.setDocuments([]); await f.service.refresh(signal(), () => {});
  expect((await f.index.literalQuery(["new"])).hits).toEqual([]);
  f.switchScope(); await expect(f.service.search("new", undefined, 0, signal())).rejects.toThrow("工作区已切换");
});
test("aborted refresh clears the admissible set, reports metadata-only and failed sources truthfully", async () => {
  const f = fixture(); f.setDocuments([document("n", "body")]); await f.service.refresh(signal(), () => {});
  const abort = new AbortController();
  f.source.collect = async () => { abort.abort(); return { documents: [document("n", "body")], limited: false }; };
  await expect(f.service.refresh(abort.signal, () => {})).rejects.toThrow();
  expect((await f.service.search("body", undefined, 0, signal())).hits).toEqual([]);
  f.source.collect = async () => ({ documents: [{ ...document("scan", "Scanned book"), coverage: "metadata", detail: "没有文字层" }, { id: "broken", title: "Broken", revision: "1", coverage: "failed", detail: "无法解析", sections: [] }], limited: true });
  const coverage = await f.service.refresh(signal(), () => {});
  expect(coverage).toMatchObject({ metadata: 1, failed: 1, limited: true }); expect(coverage.details).toHaveLength(2);
});
test("cached unchanged sources avoid rewrites and overlapping chunks retain phrases", async () => {
  const f = fixture(); f.setDocuments([document("n", "x".repeat(3985) + " meaningful phrase across boundary " + "y".repeat(4200))]);
  await f.service.refresh(signal(), () => {}); const upsert = vi.spyOn(f.index, "upsert");
  await f.service.refresh(signal(), () => {});
  expect(upsert.mock.calls.flatMap(([records]) => records).every((record) => record.id === "global-search:manifest")).toBe(true);
  expect((await f.service.search('"meaningful phrase across boundary"', undefined, 0, signal())).hits.length).toBeGreaterThan(0);
});

test("small documents share bounded index writes instead of a disk transaction per file", async () => {
  const f = fixture(); f.setDocuments(Array.from({ length: 100 }, (_, i) => document(`n-${i}`, "word\n".repeat(10))));
  const upsert = vi.spyOn(f.index, "upsert");
  await f.service.refresh(signal(), () => {});
  const writes = upsert.mock.calls.filter(([records]) => records.some((record) => record.path !== "global-search:manifest"));
  expect(writes.map(([records]) => records.length)).toEqual([32, 32, 32, 4]);
});

test("large manifests survive restart without rewriting unchanged sources, and missing pages force repair", async () => {
  const f = fixture(450);
  f.setDocuments(Array.from({ length: 450 }, (_, i) => document(`${String(i).padStart(3, "0")}-${"long-path".repeat(25)}`, "retained evidence")));
  await f.service.refresh(signal(), () => {});
  const manifest = (await f.index.lookup(["global-search:manifest"]))[0];
  expect(manifest.payload).toMatchObject({ version: 2 });
  const pages = (manifest.payload as { pages: string[] }).pages;
  expect(pages.length).toBeGreaterThan(1);
  for (const row of await f.index.lookup(pages)) expect(new TextEncoder().encode(JSON.stringify(row.payload)).length).toBeLessThan(60000);
  const restarted = createGlobalSearchService({ source: f.source, index: f.index, active: () => true, capacity: 450 });
  const write = vi.spyOn(f.index, "upsert");
  await restarted.refresh(signal(), () => {});
  expect(write.mock.calls.flatMap(([rows]) => rows).every((row) => row.path === "global-search:manifest")).toBe(true);
  expect((await restarted.search("retained", "note", 0, signal())).hits).toHaveLength(20);
  await f.index.upsert([{ id: pages[0], path: "global-search:manifest", revision: manifest.revision, text: "", tokens: "", payload: null }]);
  write.mockClear();
  await restarted.refresh(signal(), () => {});
  expect(write.mock.calls.flatMap(([rows]) => rows).filter((row) => row.path !== "global-search:manifest")).toHaveLength(450);
  expect((await restarted.search("retained", "note", 0, signal())).hits).toHaveLength(20);
});

test("source reads and hit verification are bounded concurrent batches with one mount snapshot", async () => {
  const scope = crypto.randomUUID(), files = createNoteFileService(scope, () => scope);
  const mounts = vi.spyOn(files, "listMounts").mockResolvedValue([{ id: "m", name: "Folder", kind: "directory", location: "/synthetic" }]);
  vi.spyOn(files, "listEntries").mockResolvedValue(Array.from({ length: 24 }, (_, i) => ({ mountId: "m", kind: "file", name: `note-${i}.md`, path: `note-${i}.md` })));
  let inFlight = 0, peak = 0;
  const read = vi.spyOn(files, "readFile").mockImplementation(async (mountId, path) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1)); inFlight--;
    return { mountId, path, name: path, kind: "file", text: "unique evidence", version: "v1" };
  });
  const source = createWorkspaceSearchSource({ repository: createObjectRepository(createObjectStorage(scope, () => scope), scope), files, getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "batch", model: "literal", active: () => true }), source, active: () => true });
  await service.refresh(signal(), () => {});
  expect(peak).toBe(6); expect(read).toHaveBeenCalledTimes(24);
  read.mockClear(); mounts.mockClear(); peak = 0;
  const result = await service.search("unique", "note", 0, signal());
  expect(result.hits).toHaveLength(20);
  expect(read).toHaveBeenCalledTimes(20); // Still validate live file bytes, never trust stale snippets.
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(peak).toBe(6);
});

test("a delayed old query cannot prune documents restored by a newer refresh", async () => {
  const f = fixture(); f.setDocuments([document("note", "old evidence")]);
  await f.service.refresh(signal(), () => {});
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const verify = vi.spyOn(f.source, "verify").mockImplementationOnce(async () => { await gate; return false; });
  const old = f.service.search("old", undefined, 0, signal());
  await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  f.setDocuments([document("note", "new evidence", "2")]);
  await f.service.refresh(signal(), () => {});
  finish(); await expect(old).rejects.toThrow("索引已更新");
  expect((await f.service.search("new", undefined, 0, signal())).hits).toHaveLength(1);
  expect((await f.index.literalQuery(["new"])).hits).toHaveLength(1);
});
test.each([
  { retainedLast: false, remainBeyondCapacity: false }, { retainedLast: true, remainBeyondCapacity: false },
  { retainedLast: false, remainBeyondCapacity: true }, { retainedLast: true, remainBeyondCapacity: true }
])("a bounded refresh retains unchanged hits (retained last: $retainedLast, old sources beyond capacity: $remainBeyondCapacity)", async ({ retainedLast, remainBeyondCapacity }) => {
  const f = fixture(450);
  const retained = document("retained", "retained unique evidence");
  const old = Array.from({ length: 449 }, (_, i) => document(`old-${i}`, `obsolete body ${i}`));
  const added = Array.from({ length: 449 }, (_, i) => document(`new-${i}`, `replacement body ${i}`));
  f.setDocuments([retained, ...old]);
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search("unique", undefined, 0, signal())).hits).toHaveLength(1);

  f.setDocuments([...(retainedLast ? [...added, retained] : [retained, ...added]), ...(remainBeyondCapacity ? old : [])]);
  expect(await f.service.refresh(signal(), () => {})).toMatchObject({ indexed: 450, limited: remainBeyondCapacity });
  expect((await f.service.search("unique", undefined, 0, signal())).hits).toHaveLength(1);
  expect((await f.index.literalQuery(["obsolete"])).hits).toEqual([]);
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search("unique", undefined, 0, signal())).hits).toHaveLength(1);
});
test("a source cut at the chunk capacity is reported as partial and excludes its unseen tail", async () => {
  const f = fixture(3);
  f.setDocuments([document("bounded", "x".repeat(10000) + " unadmitted needle"), document("excluded", "unadmitted document")]);
  expect(await f.service.refresh(signal(), () => {})).toMatchObject({ indexed: 0, partial: 1, limited: true });
  expect((await f.service.search("unadmitted", undefined, 0, signal())).hits).toEqual([]);
});
test("shrinking an admitted old document frees its surplus chunks before adding new sources", async () => {
  const f = fixture(450), retained = document("retained", "retained unique evidence");
  f.setDocuments([retained, document("shrunk", "x".repeat(4000 + 448 * 2800))]);
  await f.service.refresh(signal(), () => {});
  f.setDocuments([...Array.from({ length: 448 }, (_, i) => document(`new-${i}`, `replacement body ${i}`)),
    document("shrunk", "smaller body", "2"), retained]);
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search("unique", undefined, 0, signal())).hits).toHaveLength(1);
  expect((await f.service.search("smaller", undefined, 0, signal())).hits).toHaveLength(1);
});
test("an interrupted replacement rebuilds after a retry with a different bounded selection", async () => {
  const f = fixture(450), retained = document("retained", "retained unique evidence");
  f.setDocuments([retained, ...Array.from({ length: 449 }, (_, i) => document(`old-${i}`, `old body ${i}`))]);
  await f.service.refresh(signal(), () => {});
  const controller = new AbortController(), upsert = f.index.upsert;
  const write = vi.spyOn(f.index, "upsert").mockImplementation(async (records, requestSignal) => {
    const result = await upsert(records, requestSignal);
    if (records.some((row) => row.path === "interrupted-300")) controller.abort();
    return result;
  });
  f.setDocuments([retained, ...Array.from({ length: 449 }, (_, i) => document(`interrupted-${i}`, `orphan body ${i}`))]);
  await expect(f.service.refresh(controller.signal, () => {})).rejects.toThrow();
  write.mockRestore();
  f.setDocuments([retained, ...Array.from({ length: 449 }, (_, i) => document(`final-${i}`, `final body ${i}`))]);
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search("unique", undefined, 0, signal())).hits).toHaveLength(1);
  expect((await f.index.literalQuery(["orphan"])).hits).toEqual([]);
});
test("refresh restores a transiently rejected hit with the same source revision, including after service recreation", async () => {
  const f = fixture(); f.setDocuments([document("n", "owned recovered"), document("keep", "unchanged neighbor")]);
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search("owned", undefined, 0, signal())).hits).toHaveLength(1);
  const verify = vi.spyOn(f.source, "verify").mockResolvedValueOnce(false);
  expect((await f.service.search("owned", undefined, 0, signal())).hits).toEqual([]);
  verify.mockRestore();
  const recreated = createGlobalSearchService({ index: f.index, source: f.source, active: () => true });
  const upsert = vi.spyOn(f.index, "upsert");
  await recreated.refresh(signal(), () => {});
  expect((await recreated.search("owned", undefined, 0, signal())).hits).toHaveLength(1);
  expect((await recreated.search("neighbor", undefined, 0, signal())).hits).toHaveLength(1);
  expect(upsert.mock.calls.flatMap(([records]) => records).some((record) => record.path === "keep")).toBe(false);
});
test("same-revision title, group and locator changes replace cached records after restart", async () => {
  const f = fixture();
  const first = document("canvas", "owned comparison", "same-file-hash");
  f.setDocuments([{ ...first, title: "hashed.canvas" }]);
  await f.service.refresh(signal(), () => {});
  f.setDocuments([{ ...first, title: "Research board", sections: [{ ...first.sections[0], group: "artifact",
    locator: { path: "liteasy://objects/board?scope=test", line: 7 } }] }]);
  const reopened = createGlobalSearchService({ index: f.index, source: f.source, active: () => true });
  await reopened.refresh(signal(), () => {});
  expect((await reopened.search("owned", "note", 0, signal())).hits).toEqual([]);
  expect((await reopened.search("owned", "artifact", 0, signal())).hits[0]).toMatchObject({
    title: "Research board", group: "artifact", path: "liteasy://objects/board?scope=test", line: 7,
  });
});
test("real object storage indexes note body and invalidates an edited or tombstoned note", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  const source = createWorkspaceSearchSource({ repository, files: createNoteFileService(scope, () => scope), getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "test", model: "literal", active: () => true }), source, active: () => true });
  const note = await repository.create({ kind: "content.note", title: "CicN", content: { schema: "liteasy.note/v1", payload: { origin: "user", text: "# Analysis\nMy unique annotation terminology" } } });
  await service.refresh(signal(), () => {});
  const hit = (await service.search("terminology", undefined, 0, signal())).hits[0]; expect(hit.title).toBe("CicN"); expect(hit.snippet).toContain("unique annotation");
  const edited = await repository.editNote(refOf(note), "Replacement body");
  await expect(service.verify(hit, signal())).rejects.toThrow("来源已修改");
  await service.refresh(signal(), () => {}); expect((await service.search("Replacement", undefined, 0, signal())).hits).toHaveLength(1);
  await repository.setLifecycle(refOf(edited), "tombstoned");
  expect((await service.search("Replacement", undefined, 0, signal())).hits).toEqual([]);
});

test("paper bodies and private annotations carry a real page locator; removing the paper invalidates both", async () => {
  const artifacts = await import("../app/features/library/userPaperArtifactClient");
  const { savePdfAnnotations, pdfAnnotationStorageKey } = await import("../app/features/pdf/pdfAnnotationStorage");
  const scope = crypto.randomUUID(), paper = { id: "synthetic-paper", title: "Synthetic source", contentHash: "fixture-r1" };
  let papers = [paper];
  const load = vi.spyOn(artifacts, "loadUserPaperArtifact").mockImplementation(async ({ artifactKind }) => artifactKind === "fulltext" ? { version: 2, parser: "local_pdfjs", extractedAt: "now", pages: [{ page: 7, text: "正文 lexical evidence", textExtraction: "embedded" }] } as never : undefined);
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [{ createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", excerpt: "lexical evidence", id: "annotation-7", kind: "note", page: 7, paperIdentity: { candidates: [], paperId: paper.id, primary: { kind: "local", value: paper.id }, title: paper.title }, rects: [], text: "My counterexample", visibility: "private" }]);
  const source = createWorkspaceSearchSource({ repository: createObjectRepository(createObjectStorage(scope, () => scope), scope), files: createNoteFileService(scope, () => scope), getPapers: () => papers, active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "test", model: "literal", active: () => true }), source, active: () => true });
  try {
    const coverage = await service.refresh(signal(), () => {}); expect(coverage.partial).toBe(1);
    expect((await service.search("正文", "body", 0, signal())).hits[0]).toMatchObject({ paperId: paper.id, page: 7, group: "body" });
    const hit = (await service.search("counterexample", "annotation", 0, signal())).hits[0];
    expect(hit).toMatchObject({ page: 7, annotationId: "annotation-7", quote: "lexical evidence" });
    papers = []; await expect(service.verify(hit, signal())).rejects.toThrow("来源已修改");
  } finally { load.mockRestore(); localStorage.removeItem(pdfAnnotationStorageKey(paper)!); }
});

test("external-note hits are re-read and revoked mounts cannot expose cached bodies", async () => {
  const scope = crypto.randomUUID(); let mounted = true, text = "Private local search term", version = "v1";
  const files = createNoteFileService(scope, () => scope);
  vi.spyOn(files, "listMounts").mockImplementation(async () => mounted ? [{ id: "m", name: "Granted folder", kind: "directory", location: "/synthetic" }] : []);
  vi.spyOn(files, "listEntries").mockResolvedValue([{ mountId: "m", kind: "file", name: "note.md", path: "note.md" }]);
  vi.spyOn(files, "readFile").mockImplementation(async () => ({ mountId: "m", kind: "file", name: "note.md", path: "note.md", text, version }));
  const source = createWorkspaceSearchSource({ repository: createObjectRepository(createObjectStorage(scope, () => scope), scope), files, getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "test", model: "literal", active: () => true }), source, active: () => true });
  await service.refresh(signal(), () => {}); const hit = (await service.search("Private", "note", 0, signal())).hits[0]; expect(hit).toBeDefined();
  text = "New external text"; version = "v2";
  expect((await service.search("Private", "note", 0, signal())).hits).toEqual([]);
  await service.refresh(signal(), () => {}); expect((await service.search("New", "note", 0, signal())).hits).toHaveLength(1);
  mounted = false; expect((await service.search("New", "note", 0, signal())).hits).toEqual([]);
});

test("a managed Canvas uses its board title and artifact group instead of exposing a hash filename", async () => {
  const scope = crypto.randomUUID(), repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  const board = await repository.create({ kind: "workspace.board", title: "Research synthesis", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  await repository.setBoardFileBinding(board.objectId, { mountId: "boards", path: "a".repeat(64) + ".canvas" });
  const files = createNoteFileService(scope, () => scope), path = "a".repeat(64) + ".canvas";
  vi.spyOn(files, "listMounts").mockResolvedValue([{ id: "boards", name: "Managed boards", kind: "directory", location: "/synthetic" }]);
  vi.spyOn(files, "listEntries").mockResolvedValue([{ mountId: "boards", kind: "file", name: path, path }]);
  vi.spyOn(files, "readFile").mockResolvedValue({ mountId: "boards", kind: "file", name: path, path, text: JSON.stringify({ nodes: [{ type: "text", text: "Key comparison finding" }], edges: [] }), version: "r1" });
  const source = createWorkspaceSearchSource({ repository, files, getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "test", model: "literal", active: () => true }), source, active: () => true });
  await service.refresh(signal(), () => {});
  expect((await service.search("comparison", "artifact", 0, signal())).hits[0]).toMatchObject({ title: "Research synthesis", group: "artifact" });
});

test("a book title matches once in metadata without admitting unrelated body chunks or mixed-field terms", async () => {
  const f = fixture();
  f.setDocuments([{ id: "book", title: "巴赫传", revision: "1", coverage: "indexed", sections: [
    { key: "metadata", group: "metadata", text: "巴赫传\n作者", locator: { path: "book" } },
    { key: "body", group: "body", text: "这里是关于城市生活的叙述，与检索主题无关。\n".repeat(400) + "赋格的结构。", locator: { path: "book", line: 1 } },
  ] }]);
  await f.service.refresh(signal(), () => {});
  const result = await f.service.search("巴赫", undefined, 0, signal());
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]).toMatchObject({ group: "metadata", title: "巴赫传", snippet: "巴赫传\n作者" });
  expect(result.hits[0].line).toBeUndefined();
  expect(result.hits[0].quote).toBeUndefined();
  expect(result.nextOffset).toBeNull();
  expect((await f.service.search("巴赫", "body", 0, signal())).hits).toEqual([]);
  expect((await f.service.search("巴赫 赋格", undefined, 0, signal())).hits).toEqual([]);
});

test("imported books retain a filename hit and only real body matches, including matches late in the book", async () => {
  const { createReadingLibraryRepository } = await import("../app/features/reading-library/readingLibraryRepository");
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope);
  const library = createReadingLibraryRepository(storage, scope);
  const text = "这段叙述与所查询的人物无关。\n".repeat(900) + "巴赫的赋格结构值得分析。";
  const imported = await library.importFile("巴赫传.epub", new TextEncoder().encode("synthetic fixture"), {
    format: "epub", title: "巴赫传", authors: ["Test Author"], chapters: [{ id: "ch1", title: "第一章", plainText: text, content: text, format: "text" }],
    toc: [], resources: [], warnings: [],
  });
  const source = createWorkspaceSearchSource({ repository: createObjectRepository(storage, scope), files: createNoteFileService(scope, () => scope), getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "test", model: "literal", active: () => true }), source, active: () => true });
  await service.refresh(signal(), () => {});
  const result = await service.search("巴赫", undefined, 0, signal());
  expect(result.hits.filter((hit) => hit.group === "metadata")).toHaveLength(1);
  const bodies = result.hits.filter((hit) => hit.group === "body");
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.length).toBeLessThanOrEqual(2); // Chunk overlap may retain the same genuine occurrence twice.
  for (const hit of bodies) {
    expect(hit).toMatchObject({ readingId: imported.entry.id, quote: "巴赫" });
    expect(hit.snippet).toContain("巴赫的赋格");
    expect(hit.line).toBeGreaterThan(800);
  }
  expect(result.nextOffset).toBeNull();
  expect((await service.search("巴赫传.epub", "metadata", 0, signal())).hits).toHaveLength(1);
});

test("notes and connected filenames remain searchable independently of their body", async () => {
  const scope = crypto.randomUUID(), repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  await repository.create({ kind: "content.note", title: "巴赫笔记", content: { schema: "liteasy.note/v1", payload: { origin: "user", text: "尚未写入内容。" } } });
  const files = createNoteFileService(scope, () => scope);
  vi.spyOn(files, "listMounts").mockResolvedValue([{ id: "m", name: "Folder", kind: "directory", location: "/synthetic" }]);
  vi.spyOn(files, "listEntries").mockResolvedValue([{ mountId: "m", kind: "file", name: "巴赫.md", path: "巴赫.md" }]);
  vi.spyOn(files, "readFile").mockResolvedValue({ mountId: "m", kind: "file", name: "巴赫.md", path: "巴赫.md", text: "无关的正文。", version: "v1" });
  const source = createWorkspaceSearchSource({ repository, files, getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ index: createSemanticIndex({ scope, workspace: "test", model: "literal", active: () => true }), source, active: () => true });
  await service.refresh(signal(), () => {});
  const hits = (await service.search("巴赫", undefined, 0, signal())).hits;
  expect(hits.map((hit) => hit.title).sort()).toEqual(["巴赫.md", "巴赫笔记"]);
  expect(hits.every((hit) => hit.group === "metadata" && hit.snippet.includes("巴赫"))).toBe(true);
  expect((await service.search("巴赫", "note", 0, signal())).hits).toEqual([]);
});

test("advanced search applies tags and formats before pagination and keeps filter-only files unique", async () => {
  const f = fixture();
  f.setDocuments(Array.from({ length: 50 }, (_, i) => {
    const value = document(String(i).padStart(2, "0"), `Memory number ${i}`);
    return { ...value, metadata: { tags: i < 5 ? ["翻译"] : ["精读"], format: "markdown", assetType: "note" },
      sections: [{ key: "meta", group: "metadata" as const, text: value.title, locator: { path: value.sections[0].locator.path } }, ...value.sections] };
  }));
  await f.service.refresh(signal(), () => {});
  const query = '/memory number \\d+/i tag:精读 -tag:翻译 format:md -type:book';
  const first = await f.service.search(query, "note", 0, signal());
  const second = await f.service.search(query, "note", first.nextOffset!, signal());
  expect(first.hits).toHaveLength(20); expect(second.hits).toHaveLength(20);
  expect(first.hits[0]).toMatchObject({ documentId: "05", quote: "Memory number 5", matchedText: "Memory number 5" });
  expect(new Set([...first.hits, ...second.hits].map((hit) => hit.documentId)).size).toBe(40);
  const onlyTags = await f.service.search('tag:精读 -format:pdf', undefined, 0, signal());
  expect(onlyTags.hits).toHaveLength(20); expect(onlyTags.hits.every((hit) => hit.group === "metadata")).toBe(true);
  await expect(f.service.search('/[/', undefined, 0, signal())).rejects.toThrow("正则表达式");
});

test("regex scanning cannot read beyond the admitted corpus and can be canceled", async () => {
  const f = fixture(3); f.setDocuments([document("bounded", "x".repeat(10000) + " unadmitted needle")]);
  await f.service.refresh(signal(), () => {});
  expect((await f.service.search('/unadmitted/', undefined, 0, signal())).hits).toEqual([]);
  const request = new AbortController(); request.abort();
  await expect(f.service.search('/x+/', undefined, 0, request.signal)).rejects.toThrow();
});

test("library tags and note labels are indexed and verified independently of body revisions", async () => {
  const { createReadingLibraryRepository } = await import("../app/features/reading-library/readingLibraryRepository");
  const { createNotesRepository } = await import("../app/features/notes/notesRepository");
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  const library = createReadingLibraryRepository(storage, scope);
  const { entry: file } = await library.importFile("记忆.md", new TextEncoder().encode("# memory"), {
    title: "Memory note", format: "markdown", authors: [], chapters: [{ id: "1", title: "memory", format: "markdown", content: "memory body", plainText: "memory body" }], toc: [], resources: [], warnings: [],
  });
  await library.updateMetadata(file.id, { tags: ["精读"], assetType: "note" });
  const note = await repository.create({ kind: "content.note", title: "Translated", content: { schema: "liteasy.note/v1", payload: { origin: "user", text: "memory translated" } } });
  const notes = createNotesRepository(storage); await notes.setLabel({ kind: "object", ref: refOf(note) }, "translation", true);
  const source = createWorkspaceSearchSource({ repository, files: createNoteFileService(scope, () => scope), getPapers: () => [], active: () => true });
  const service = createGlobalSearchService({ source, active: () => true, index: createSemanticIndex({ scope, workspace: "advanced", model: "literal", active: () => true }) });
  await service.refresh(signal(), () => {});
  const tagged = await service.search('memory tag:精读 format:md', "body", 0, signal());
  expect(tagged.hits).toHaveLength(1);
  expect((await service.search('tag:翻译结果', "note", 0, signal())).hits).toHaveLength(1);
  await library.updateMetadata(file.id, { tags: ["忽略"] });
  await expect(service.verify(tagged.hits[0], signal())).rejects.toThrow("来源已修改");
  expect((await service.search('memory tag:精读', "body", 0, signal())).hits).toEqual([]);
  await service.refresh(signal(), () => {});
  expect((await service.search('tag:忽略', undefined, 0, signal())).hits).toHaveLength(1);
});
