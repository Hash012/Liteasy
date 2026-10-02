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
function fixture() {
  let active = true;
  let documents: SearchDocument[] = [];
  const source: SearchSource = { collect: async () => ({ documents, limited: false }), verify: async (hit) => documents.some((d) => d.id === hit.documentId && d.revision === hit.revision) };
  const index = createSemanticIndex({ scope: crypto.randomUUID(), workspace: "test", model: "literal", active: () => active });
  const service = createGlobalSearchService({ index, source, active: () => active });
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
