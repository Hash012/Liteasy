import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { createObjectStorage, type ObjectStorage, type StorageChange } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createReadingLibraryRepository, MAX_LIBRARY_FILE_BYTES } from "../app/features/reading-library/readingLibraryRepository";
import { parseReadingFile } from "../app/features/reading-library/parseReadingFile";
import { resolveContextSnapshot } from "../app/features/context/objectContext";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { resolveLiteasyContext } from "../app/features/resource-filesystem/resourceContext";
import type { NoteFileService } from "../app/features/note-files/noteFileService";
import { refOf } from "../app/features/objects/object.types";

function fixture() {
  const scope = crypto.randomUUID();
  let current = scope;
  const storage = createObjectStorage(scope, () => current);
  return {
    scope, storage,
    repository: createReadingLibraryRepository(storage, scope),
    objects: createObjectRepository(storage, scope),
    reopen: () => createReadingLibraryRepository(createObjectStorage(scope, () => current), scope),
    switchAccount: () => { current = crypto.randomUUID(); return current; }
  };
}
async function file(name = "研究手册.md", text = "# 研究手册\n\n这是文件里的真实正文。\n\n## 方法\n稳定性与复现。") {
  const bytes = new TextEncoder().encode(text);
  return { name, bytes, parsed: await parseReadingFile({ name, bytes }) };
}
function failOneCommit(storage: ObjectStorage, prefix: string) {
  const commit = storage.commit.bind(storage);
  let failed = false;
  return vi.spyOn(storage, "commit").mockImplementation(async (changes) => {
    if (!failed && changes.some((item) => item.key.startsWith(prefix))) {
      failed = true;
      throw new Error("磁盘暂时不可写");
    }
    return commit(changes);
  });
}

async function replaceAsset(storage: ObjectStorage, assetId: string, bytes: Uint8Array) {
  const key = `asset/${assetId}`;
  const row = await storage.get(key);
  if (!row) throw new Error("test asset missing");
  await storage.commit([{
    key, expected: row.version,
    row: { ...row, version: crypto.randomUUID(), value: { ...(row.value as object), base64: btoa(String.fromCharCode(...bytes)) } }
  }]);
}

test("persists original bytes and resolves the file's real text through its Liteasy Path", async () => {
  const f = fixture(), source = await file();
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  expect(await f.reopen().list()).toEqual([entry]);
  expect(Array.from((await f.reopen().readFile(entry.id)).bytes)).toEqual(Array.from(source.bytes));
  expect(entry).toMatchObject({ format: "markdown", title: "研究手册", fileSize: source.bytes.length, contextTruncated: false });
  const attachments = await resolveLiteasyContext({
    path: liteasyPath(f.scope, { kind: "object", ref: entry.ref, followLatest: true }),
    repository: f.objects, files: {} as NoteFileService, getPapers: () => [], getArtifacts: async () => [],
    artifactScopeId: f.scope, active: () => true, capturePapers: vi.fn(), captureAnnotation: vi.fn(), resolveBoard: vi.fn()
  });
  const snapshot = await resolveContextSnapshot({ repository: f.objects, refs: attachments[0].refs, purpose: "分析原文件", persist: false });
  expect(snapshot.entries[0]).toMatchObject({ title: "研究手册", trustLabel: "source" });
  expect(snapshot.entries[0].text).toContain("这是文件里的真实正文。");
  expect(snapshot.entries[0].text).toContain("稳定性与复现。");
});

test("keeps files and metadata isolated by account and invalidates old handles after switching", async () => {
  const f = fixture(), source = await file();
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  await f.repository.updateMetadata(entry.id, { tags: ["研究"], readingStatus: "finished" });
  const otherScope = crypto.randomUUID();
  const other = createReadingLibraryRepository(createObjectStorage(otherScope, () => otherScope), otherScope);
  expect(await other.list()).toEqual([]);
  expect(await other.metadata()).toEqual({});
  await expect(other.readFile(entry.id)).rejects.toThrow();
  const ownImport = await other.importFile(source.name, source.bytes, source.parsed);
  expect(ownImport.entry.id).not.toBe(entry.id);
  expect(ownImport.entry.ref.objectId).not.toBe(entry.ref.objectId);
  f.switchAccount();
  await expect(f.repository.list()).rejects.toMatchObject({ code: "object_forbidden" });
  await expect(f.repository.readFile(entry.id)).rejects.toMatchObject({ code: "object_forbidden" });
  await expect(f.repository.updateMetadata(entry.id, { tags: ["wrong-account"] })).rejects.toMatchObject({ code: "object_forbidden" });
});

test("reuses the same import while preserving different names and changed bytes independently", async () => {
  const f = fixture(), first = await file();
  const imported = await f.repository.importFile(first.name, first.bytes, first.parsed);
  const duplicate = await f.repository.importFile(first.name, first.bytes, first.parsed);
  expect(duplicate).toEqual({ entry: imported.entry, duplicate: true });
  const renamed = await f.repository.importFile("另一来源.md", first.bytes, first.parsed);
  expect(renamed.duplicate).toBe(false);
  expect(renamed.entry.id).not.toBe(imported.entry.id);
  expect(renamed.entry.ref.objectId).not.toBe(imported.entry.ref.objectId);
  expect(renamed.entry.assetId).toBe(imported.entry.assetId);
  const changed = await file(first.name, "# 新版本\n修改后的正文。");
  await f.repository.importFile(changed.name, changed.bytes, changed.parsed);
  expect(await f.repository.list()).toHaveLength(3);
  expect(Array.from((await f.repository.readFile(imported.entry.id)).bytes)).toEqual(Array.from(first.bytes));
});

test("listing reads compact metadata only, and metadata updates merge without losing reading state", async () => {
  const f = fixture(), source = await file();
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  await f.repository.updateMetadata(entry.id, { readingStatus: "finished", collection: "计算方法", tags: ["复现", "复现"] });
  await f.repository.updateMetadata(entry.id, { tags: ["复现", "经典"] });
  const get = vi.spyOn(f.storage, "get");
  const list = vi.spyOn(f.storage, "list");
  expect(await f.repository.list()).toHaveLength(1);
  expect(await f.repository.metadata()).toEqual({ [entry.id]: { readingStatus: "finished", collection: "计算方法", tags: ["复现", "经典"] } });
  expect(get).not.toHaveBeenCalled();
  expect(list.mock.calls.every(([prefix]) => prefix.startsWith("reading-library/"))).toBe(true);
  await expect(f.repository.updateMetadata(entry.id, { tags: ["x".repeat(61)] })).rejects.toThrow();
  expect((await f.repository.metadata())[entry.id].readingStatus).toBe("finished");
});

test("detects changed original bytes even if the damaged asset has the same size", async () => {
  const f = fixture(), source = await file("a.txt", "original");
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  await replaceAsset(f.storage, entry.assetId, new TextEncoder().encode("changed!"));
  await expect(f.repository.readFile(entry.id)).rejects.toThrow("文件校验失败");
});

test("removing from the library preserves referenced text, original assets, and metadata for reimport", async () => {
  const f = fixture(), source = await file();
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  await f.repository.updateMetadata(entry.id, { readingStatus: "finished", tags: ["珍藏"] });
  await f.repository.removeFromLibrary(entry.id);
  expect(await f.repository.list()).toEqual([]);
  const snapshot = await resolveContextSnapshot({ repository: f.objects, refs: [entry.ref], purpose: "历史引用", persist: false });
  expect(snapshot.entries[0].text).toContain("这是文件里的真实正文。");
  expect(await f.objects.readAsset(entry.assetId)).toMatchObject({ byteLength: source.bytes.length });
  const restored = await f.repository.importFile(source.name, source.bytes, source.parsed);
  expect(restored.entry.ref).toEqual(entry.ref);
  expect((await f.repository.metadata())[entry.id]).toMatchObject({ readingStatus: "finished", tags: ["珍藏"] });
});

test.each(["reading-library/import/", "asset/", "operation/legacy-reading-file:", "reading-library/file/"])("a failure at %s can be retried without exposing a partial catalog entry", async (prefix) => {
  const f = fixture(), source = await file();
  const failing = failOneCommit(f.storage, prefix);
  await expect(f.repository.importFile(source.name, source.bytes, source.parsed)).rejects.toThrow("磁盘暂时不可写");
  expect(await f.repository.list()).toEqual([]);
  failing.mockRestore();
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  expect(Array.from((await f.repository.readFile(entry.id)).bytes)).toEqual(Array.from(source.bytes));
  expect(await f.repository.list()).toEqual([entry]);
  expect(await f.storage.list("head/")).toHaveLength(1);
});

test("does not infer a rename from matching bytes after removal and preserves the previous source reference", async () => {
  const f = fixture(), source = await file("原名.txt", "无标题的原始正文。");
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  await f.repository.removeFromLibrary(entry.id);
  const renamed = await file("新名字.txt", "无标题的原始正文。");
  const restored = await f.repository.importFile(renamed.name, renamed.bytes, renamed.parsed);
  expect(restored.entry.id).not.toBe(entry.id);
  expect(restored.entry.ref.objectId).not.toBe(entry.ref.objectId);
  expect(Array.from((await f.repository.readFile(restored.entry.id)).bytes)).toEqual(Array.from(source.bytes));
  const snapshot = await resolveContextSnapshot({ repository: f.objects, refs: [entry.ref], purpose: "原引用", persist: false });
  expect(snapshot.entries[0].text).toContain("无标题的原始正文。");
});

test("concurrent imports converge on one source and one catalog entry", async () => {
  const f = fixture(), source = await file();
  const get = f.storage.get.bind(f.storage);
  let readers = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(f.storage, "get").mockImplementation(async (key) => {
    const result = await get(key);
    if (key.startsWith("asset/") && !result && readers < 2) {
      readers += 1;
      if (readers === 2) release();
      await barrier;
    }
    return result;
  });
  const results = await Promise.all([
    f.repository.importFile(source.name, source.bytes, source.parsed),
    f.repository.importFile(source.name, source.bytes, source.parsed)
  ]);
  expect(results[0].entry.ref).toEqual(results[1].entry.ref);
  expect(results.filter((item) => !item.duplicate)).toHaveLength(1);
  expect(await f.repository.list()).toHaveLength(1);
  expect(await f.storage.list("head/")).toHaveLength(1);
});

test("lists catalogs beyond one storage page without skipping or duplicating rows", async () => {
  const f = fixture(), source = await file();
  const { entry } = await f.repository.importFile(source.name, source.bytes, source.parsed);
  const changes: StorageChange[] = Array.from({ length: 501 }, (_, index) => {
    const id = `reading:fixture-${String(index).padStart(4, "0")}`;
    const key = `reading-library/file/${id}`;
    return { key, expected: null, row: { key, version: crypto.randomUUID(), value: { ...entry, id } } };
  });
  await f.storage.commit(changes);
  const entries = await f.repository.list();
  expect(entries).toHaveLength(502);
  expect(new Set(entries.map((item) => item.id)).size).toBe(502);
});

test("rejects empty or oversized source files before touching storage", async () => {
  const f = fixture(), source = await file();
  const commit = vi.spyOn(f.storage, "commit");
  await expect(f.repository.importFile("empty.txt", new Uint8Array(), source.parsed)).rejects.toThrow("20 MB");
  await expect(f.repository.importFile("huge.epub", new Uint8Array(MAX_LIBRARY_FILE_BYTES + 1), source.parsed)).rejects.toThrow("20 MB");
  expect(commit).not.toHaveBeenCalled();
});

test("stores opaque file formats without parsing or changing their bytes", async () => {
  const f = fixture();
  const bytes = new Uint8Array([0, 255, 40, 11, 128, 79]);
  const imported = await f.repository.importFile("实验数据.bin", bytes, {
    format: "other", title: "实验数据.bin", authors: [], chapters: [], resources: [], toc: [], warnings: []
  });
  expect(imported.entry.format).toBe("other");
  expect((await f.reopen().readFile(imported.entry.id)).bytes).toEqual(bytes);
  expect((await f.repository.importFile("再次导入.bin", bytes, {
    format: "other", title: "再次导入.bin", authors: [], chapters: [], resources: [], toc: [], warnings: []
  })).duplicate).toBe(false);
});

test("same bytes at distinct exact source paths or with different bibliography remain independent", async () => {
  const f = fixture(), source = await file();
  const first = await f.repository.importFile(source.name, source.bytes, source.parsed, {
    source: { kind: "source-path", location: "/Synthetic/Collection/guide.md" }
  });
  const again = await f.repository.importFile(source.name, source.bytes, source.parsed, {
    source: { kind: "source-path", location: "/Synthetic/Collection/guide.md" }
  });
  expect(again).toEqual({ entry: first.entry, duplicate: true });
  const differentPath = await f.repository.importFile(source.name, source.bytes, source.parsed, {
    source: { kind: "source-path", location: "/synthetic/collection/guide.md" }
  });
  const differentBook = await f.repository.importFile(source.name, source.bytes, { ...source.parsed, identifier: "synthetic-edition-two" }, {
    source: { kind: "source-path", location: "/Synthetic/Collection/guide.md" }
  });
  expect(new Set([first, differentPath, differentBook].map((result) => result.entry.id)).size).toBe(3);
  expect(new Set([first, differentPath, differentBook].map((result) => result.entry.ref.objectId)).size).toBe(3);
  expect(new Set([first, differentPath, differentBook].map((result) => result.entry.assetId)).size).toBe(1);
  await f.repository.updateMetadata(first.entry.id, { tags: ["first-source-only"] });
  expect((await f.repository.metadata())[differentPath.entry.id]).toBeUndefined();
  await f.repository.removeFromLibrary(first.entry.id);
  expect(Array.from((await f.reopen().readFile(differentPath.entry.id)).bytes)).toEqual(Array.from(source.bytes));
  expect((await f.objects.get(first.entry.ref)).title).toBe(source.parsed.title);
});

test("adopts a matching legacy hash entry without changing its ID, pinned reference, bytes or saved metadata", async () => {
  const f = fixture(), source = await file();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", source.bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
  const id = `reading:${hash}`, legacyKey = `reading-file:${hash}`;
  const descriptor = { assetId: hash, sha256: hash, byteLength: source.bytes.length, mediaType: "text/markdown" };
  const oldSource = await f.objects.legacy(legacyKey, {
    kind: "source.document", title: source.parsed.title, assets: [descriptor],
    content: { schema: "liteasy.source-document/v1", payload: { paperId: id, text: "Pinned pre-upgrade text.", availability: "local", legacyKey, documentHash: hash } },
  });
  const oldEntry = { id, ref: refOf(oldSource), assetId: hash, fileName: source.name,
    format: "markdown", title: source.parsed.title, authors: source.parsed.authors,
    fileSize: source.bytes.length, addedAt: "2025-01-01T00:00:00.000Z", contextTruncated: false };
  await f.storage.commit([
    { key: `asset/${hash}`, expected: null, row: { key: `asset/${hash}`, version: "legacy-asset", value: { ...descriptor, base64: btoa(String.fromCharCode(...source.bytes)) } } },
    { key: `reading-library/file/${id}`, expected: null, row: { key: `reading-library/file/${id}`, version: "legacy-entry", value: oldEntry } },
  ]);
  await f.repository.updateMetadata(id, { tags: ["pre-upgrade"], readingStatus: "finished" });
  const imported = await f.repository.importFile(source.name, source.bytes, source.parsed);
  expect(imported).toEqual({ entry: oldEntry, duplicate: true });
  expect((await f.storage.get(`reading-library/file/${id}`))?.version).toBe("legacy-entry");
  const other = await f.repository.importFile(source.name, source.bytes, source.parsed, {
    source: { kind: "source-path", location: "/synthetic/previously-unknown/guide.md" },
  });
  expect(other.entry.id).not.toBe(id);
  expect(other.entry.ref.objectId).not.toBe(oldSource.objectId);
  expect(other.entry.assetId).toBe(hash);
  expect(await f.objects.get(oldEntry.ref)).toEqual(oldSource);
  expect((await f.repository.metadata())[id]).toMatchObject({ tags: ["pre-upgrade"], readingStatus: "finished" });
  await f.repository.removeFromLibrary(id);
  const restored = await f.reopen().importFile(source.name, source.bytes, source.parsed);
  expect(restored.entry.id).toBe(id);
  expect(restored.entry.ref).toEqual(oldEntry.ref);
  expect(Array.from((await f.repository.readFile(id)).bytes)).toEqual(Array.from(source.bytes));
});

test("different sources racing on one asset retain separate objects and one immutable byte asset", async () => {
  const f = fixture(), source = await file();
  const results = await Promise.all(["/synthetic/a/guide.md", "/synthetic/b/guide.md"].map((location) => f.repository.importFile(
    source.name, source.bytes, source.parsed, { source: { kind: "source-path", location } },
  )));
  expect(results.every((item) => !item.duplicate)).toBe(true);
  expect(new Set(results.map((item) => item.entry.id)).size).toBe(2);
  expect(await f.storage.list("asset/")).toHaveLength(1);
  expect(await f.storage.list("head/")).toHaveLength(2);
  expect(await f.repository.list()).toHaveLength(2);
});


test("metadata edits preserve additive fields from a newer compatible writer", async () => {
  const f = fixture();
  const key = "reading-library/metadata/file-1";
  await f.storage.commit([{ key, expected: null, row: { key, version: "before", value: { tags: ["old"], futureExtension: { preserved: true } } } }]);
  await f.repository.updateMetadata("file-1", { tags: ["new"] });
  expect((await f.storage.get(key))?.value).toEqual({ tags: ["new"], futureExtension: { preserved: true } });
});
