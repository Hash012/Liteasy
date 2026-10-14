import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useResourceLinksController } from "../app/controllers/useResourceLinksController";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { createResourceReferenceService } from "../app/features/resource-links/resourceReferenceService";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { referenceCharacters, referenceFragment } from "../app/features/resource-links/referenceText";
import { resolveContextSnapshot } from "../app/features/context/objectContext";
import { objectText, refOf } from "../app/features/objects/object.types";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
async function fixture() {
  const scope = crypto.randomUUID(), repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  const projects = createPaperProjectRepository(createObjectStorage(scope, () => scope), scope);
  const source = await repository.create({ kind: "content.note", title: "CicN", content: { schema: "liteasy.note/v1", payload: { text: "# CicN\nnot needed\n## Title1\nrequested evidence\n## Other\nprivate unrelated tail", origin: "user" } } });
  const assets = createWorkspaceAgentAssetService({ repository, projects, getPapers: () => [], active: () => true });
  const path = liteasyPath(scope, { kind: "object", ref: refOf(source), followLatest: true });
  return { scope, repository, source, path, assets };
}

test("selected section persists as an immutable fragment; actual AI context excludes the rest of its source", async () => {
  const f = await fixture();
  const { result } = renderHook(() => useResourceLinksController({ repository: f.repository, assets: f.assets, suggestions: [], papers: [], open: vi.fn() }));
  const document = await result.current.service.document(f.path);
  const selected = referenceFragment(document.text, "Title1");
  const token = await result.current.capture(document, selected);
  const context = await resolveContextSnapshot({ repository: f.repository, refs: token.contextRefs!, purpose: "chat", persist: false });
  expect(context.entries).toHaveLength(1);
  expect(context.entries[0].text).toBe("## Title1\nrequested evidence");
  expect(JSON.stringify(context.entries)).not.toContain("private unrelated tail");
  const fragment = await f.repository.get(token.contextRefs![0] as ReturnType<typeof refOf>);
  expect(fragment.provenance.sourceRefs).toEqual([refOf(f.source)]);
  const changed = await f.assets.write(f.path, { text: "new revision", expectedRevision: f.source.revision });
  expect(changed.changed).toBe(true);
  expect(objectText(await f.repository.get(refOf(fragment)))).toBe(selected.text);
  await expect(result.current.capture(document, selected)).rejects.toThrow("源文件已修改");
});

test("registered asset types get fragment capture without needing an editor-specific adapter", async () => {
  const f = await fixture(), path = `liteasy://example/plugin-asset?scope=${f.scope}`;
  f.assets.registerAdapter({ id: "example", accepts: (value) => value === path,
    search: async () => [], stat: async () => ({ path, title: "插件资产", kind: "example", capabilities: ["read"], revision: "v1" }),
    read: async () => ({ asset: { path, title: "插件资产", kind: "example", capabilities: ["read"], revision: "v1" }, text: "line one\nline two", totalCharacters: 17, offset: 0, truncated: false }) });
  const { result } = renderHook(() => useResourceLinksController({ repository: f.repository, assets: f.assets, suggestions: [], papers: [], open: vi.fn() }));
  const document = await result.current.service.document(path);
  const token = await result.current.capture(document, referenceFragment(document.text, "L2:2"));
  const context = await resolveContextSnapshot({ repository: f.repository, refs: token.contextRefs!, purpose: "chat", persist: false });
  expect(context.entries[0].text).toBe("line two");
});

test("background reads are bounded to two, and cancellation removes queued work", async () => {
  const f = await fixture();
  const completions: (() => void)[] = [];
  const original = f.assets.read;
  const reads = vi.spyOn(f.assets, "read").mockImplementation(async (path, options) => {
    await new Promise<void>((resolve) => completions.push(resolve)); return original(path, options);
  });
  const service = createResourceReferenceService({ scope: f.scope, assets: f.assets, catalog: () => [], active: () => true });
  const first = service.document(f.path), second = service.document(f.path), third = service.document(f.path);
  const abort = new AbortController();
  const canceled = service.document(f.path, 12000, abort.signal).catch((error) => error);
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
  abort.abort();
  expect(await canceled).toMatchObject({ name: "AbortError" });
  completions.shift()!(); await first;
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(3));
  completions.shift()!(); completions.shift()!();
  await Promise.all([second, third]);
});

test("a visible latest-object reference invalidates only when that object changes", async () => {
  const f = await fixture(), changed = vi.fn();
  const { result } = renderHook(() => useResourceLinksController({ repository: f.repository, assets: f.assets, suggestions: [], papers: [], open: vi.fn() }));
  const unsubscribe = result.current.service.subscribe(f.path, changed);
  await act(async () => { await f.repository.create({ kind: "content.note", title: "other", content: { schema: "liteasy.note/v1", payload: { text: "other", origin: "user" } } }); });
  expect(changed).not.toHaveBeenCalled();
  await act(async () => { await f.assets.write(f.path, { text: "edited", expectedRevision: f.source.revision }); });
  expect(changed).toHaveBeenCalledOnce();
  unsubscribe();
});


test("exact word selections survive capture and model projection without expanding", async () => {
  const f = await fixture();
  const { result } = renderHook(() => useResourceLinksController({ repository: f.repository, assets: f.assets, suggestions: [], papers: [], open: vi.fn() }));
  const document = await result.current.service.document(f.path);
  const start = document.text.indexOf("evidence");
  const selected = referenceCharacters(document.text, start, start + 8);
  const restored = referenceFragment(document.text, selected.fragment);
  const token = await result.current.capture(document, restored);
  const repeated = await result.current.capture(document, restored);
  expect(repeated.contextRefs).toEqual(token.contextRefs);
  const context = await resolveContextSnapshot({ repository: f.repository, refs: token.contextRefs!, purpose: "chat", persist: false });
  expect(context.entries[0].text).toBe("evidence");
  const fragment = await f.repository.get(token.contextRefs![0] as ReturnType<typeof refOf>);
  expect(fragment.kind === "content.fragment" && fragment.content.payload.anchors[0]).toMatchObject({
    type: "text", range: { start, end: start + 8 }, quote: { exact: "evidence", prefix: expect.stringContaining("requested ") }
  });
  await expect(result.current.capture(document, { ...restored, text: "requested evidence" })).rejects.toThrow("选区已失效");
});

test("UTF16 selectors preserve the second repeated quote and reject split graphemes", () => {
  const text = "一二三\r\n重复词 😀é 重复词";
  const normalized = text.replaceAll("\r\n", "\n");
  const start = normalized.lastIndexOf("重复词");
  const range = referenceCharacters(text, start, start + 3);
  expect(referenceFragment(text, range.fragment)).toMatchObject({ text: "重复词", offsets: { start, end: start + 3 } });
  const emoji = normalized.indexOf("😀");
  expect(() => referenceCharacters(text, emoji, emoji + 1)).toThrow("截断字符");
  const accent = normalized.indexOf("é");
  expect(() => referenceCharacters(text, accent, accent + 1)).toThrow("截断字符");
});

test("paper selections preserve original identity and truthful page-level PDF location", async () => {
  const f = await fixture();
  const { paperReferenceText } = await import("../app/features/resource-links/paperReferenceSource");
  const body = paperReferenceText({ paperId: "original-paper", documentHash: "fixed-pdf-hash", notice: "已缓存部分页面", pages: [{ page: 3, text: "same quote\r\nsecond occurrence" }] });
  const path = `liteasy://example/paper?scope=${f.scope}`;
  f.assets.registerAdapter({ id: "mapped-paper", accepts: (value) => value === path, search: async () => [],
    stat: async () => ({ path, title: "原论文", kind: "paper", capabilities: ["read"], revision: "fixed-pdf-hash" }),
    read: async () => ({ asset: { path, title: "原论文", kind: "paper", capabilities: ["read"], revision: "fixed-pdf-hash" }, ...body, totalCharacters: body.text.length, offset: 0, truncated: false }) });
  const { result } = renderHook(() => useResourceLinksController({ repository: f.repository, assets: f.assets, suggestions: [], papers: [], open: vi.fn() }));
  const document = await result.current.service.document(path);
  const start = body.text.indexOf("second"), selection = referenceFragment(document.text, `C${start}:${start + 6}`);
  const token = await result.current.capture(document, selection);
  const ref = token.contextRefs![0]; if (!("objectId" in ref)) throw new Error("missing object");
  const fragment = await f.repository.get(ref);
  expect(fragment.kind).toBe("content.fragment");
  if (fragment.kind !== "content.fragment") throw new Error("wrong kind");
  expect(fragment.content.payload.text).toBe("second");
  expect(fragment.content.payload.anchors).toEqual(expect.arrayContaining([expect.objectContaining({ type: "pdf", page: 3, documentHash: "fixed-pdf-hash", precision: "page", rects: [], quote: expect.objectContaining({ exact: "second" }) })]));
  const source = await f.repository.get(fragment.provenance.sourceRefs[0]);
  if (source.kind !== "source.document") throw new Error("wrong source");
  expect(source.content.payload).toMatchObject({ paperId: "original-paper", documentHash: "fixed-pdf-hash", pages: [{ page: 3, text: "same quote\nsecond occurrence" }] });
});

test("a page selector anchors its local offsets to the selected page snapshot", async () => {
  const f = await fixture();
  const source = await f.repository.create({ kind: "source.document", title: "多页来源", content: { schema: "liteasy.source-document/v1", payload: {
    paperId: "original-paper", legacyKey: "fixed-pages", availability: "local", text: "same phrase\nother content\nsame phrase", documentHash: "fixed-hash",
    pages: [{ page: 1, text: "same phrase" }, { page: 2, text: "same phrase" }],
  } } });
  const selectedRef = { ...refOf(source), selectorId: "page:2" };
  const path = liteasyPath(f.scope, { kind: "object", ref: selectedRef });
  const { result } = renderHook(() => useResourceLinksController({ repository: f.repository, assets: f.assets, suggestions: [], papers: [], open: vi.fn() }));
  const document = await result.current.service.document(path);
  const token = await result.current.capture(document, referenceCharacters(document.text, 0, 4));
  const fragment = await f.repository.get(token.contextRefs![0] as ReturnType<typeof refOf>);
  if (fragment.kind !== "content.fragment") throw new Error("wrong kind");
  const anchor = fragment.content.payload.anchors.find((anchor) => anchor.type === "text")!;
  const snapshot = await f.repository.get(anchor.sourceRef);
  expect(snapshot.objectId).not.toBe(source.objectId);
  expect(objectText(snapshot)).toBe("same phrase");
  expect(snapshot.provenance.sourceRefs).toContainEqual(selectedRef);
  expect(anchor).toMatchObject({ range: { start: 0, end: 4 }, quote: { exact: "same" } });
});
