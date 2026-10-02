import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useResourceLinksController } from "../app/controllers/useResourceLinksController";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { createResourceReferenceService } from "../app/features/resource-links/resourceReferenceService";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { referenceFragment } from "../app/features/resource-links/referenceText";
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
  expect(reads).toHaveBeenCalledTimes(2);
  abort.abort();
  expect(await canceled).toMatchObject({ name: "AbortError" });
  completions.shift()!(); await first;
  expect(reads).toHaveBeenCalledTimes(3);
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
