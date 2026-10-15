import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { refOf } from "../app/features/objects/object.types";
import { pdfAnnotationStorageKey } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import { resolveReferencePdf } from "../app/features/resource-links/referencePdfSource";
import { createResourceReferenceService } from "../app/features/resource-links/resourceReferenceService";
import { ResourceReferencesContext } from "../app/features/resource-links/ResourceReferencesContext";
import { ResourceReferenceView } from "../app/features/resource-links/ResourceReferenceView";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); localStorage.clear(); });
const paper = { id: "native", title: "Paper", contentHash: "hash", sourcePath: "source.pdf" };
function fixture() {
  const scopeId = crypto.randomUUID();
  const hook = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model call"); },
    getPapers: () => [paper], getSettings: () => createSettingsStore().getState(), openEvidence() {} }));
  return { hook, scopeId, repository: hook.result.current.repository, assets: hook.result.current.agentAssets };
}
test("native annotation self and PDF source resolve through the real composition without creating a surrogate", async () => {
  const f = fixture(), storageKey = pdfAnnotationStorageKey(paper)!;
  localStorage.setItem(storageKey, JSON.stringify([{ id: "a", kind: "highlight", paperIdentity: resolvePaperIdentity(paper), page: 10,
    note: "**Comment**", excerpt: "Quote", text: "Quote", images: {}, rects: [{ left: 5, top: 20, width: 40, height: 4 }], revision: 1,
    createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", publication: { desiredVisibility: "private", state: "not_published" } }]));
  const path = liteasyPath(f.scopeId, { kind: "pdf-annotation", paperId: paper.id, annotationId: "a" });
  const before = await f.repository.search("");
  const self = await f.assets.present(path);
  expect(self.kind).toBe("content");
  if (self.kind !== "content") throw new Error("expected content");
  expect(self.read.content.binding).toMatchObject({ kind: "pinned", path, scopeId: f.scopeId, revision: self.asset.revision });
  expect(self.read.text).toContain("**Comment**"); expect(self.read.text).toContain("Quote");
  const source = await f.assets.present(path, { intent: "source" });
  expect(source.kind).toBe("pdf");
  if (source.kind !== "pdf") throw new Error("expected source");
  const pdf = await resolveReferencePdf({ path: source.path, repository: f.repository, papers: [paper], intent: "origin" });
  expect(pdf?.target).toMatchObject({ page: 10, precision: "region", region: { rects: [{ x: 0.05, y: 0.2, width: 0.4, height: 0.04 }] } });
  expect((await f.repository.search("")).objects).toEqual(before.objects);
  localStorage.removeItem(storageKey);
  await expect(f.assets.present(path)).rejects.toMatchObject({ code: "not_found" });
  f.hook.unmount();
});

test("board preview is spatial, machine read remains Canvas, historical layout never uses latest", async () => {
  const f = fixture();
  let board, note;
  await act(async () => {
    board = await f.repository.create({ kind: "workspace.board", title: "研究板", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
    note = await f.repository.create({ kind: "content.note", title: "卡片", content: { schema: "liteasy.note/v1", payload: { text: "**Spatial evidence**", origin: "user" } } });
    await f.repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(note)] });
  });
  const current = await f.repository.resolveLatest(board!.objectId);
  const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(current) });
  expect(JSON.parse((await f.assets.read(path)).text).nodes).toHaveLength(1);
  const service = createResourceReferenceService({ scope: f.scopeId, assets: f.assets, active: () => true, catalog: () => [] });
  render(<ResourceReferencesContext.Provider value={{ service, open: vi.fn(), capture: vi.fn(), suggestions: [] }}><ResourceReferenceView locator={path} /></ResourceReferencesContext.Provider>);
  expect(await screen.findByLabelText("白板空间预览")).toBeInTheDocument();
  expect(screen.getByText("Spatial evidence").tagName).toBe("STRONG");
  expect(screen.queryByText(/"nodes"/)).not.toBeInTheDocument();
  await expect(f.assets.present(liteasyPath(f.scopeId, { kind: "object", ref: refOf(board!) }))).rejects.toMatchObject({ code: "revision_unavailable" });
  f.hook.unmount();
});

test("literal content retains profile, representation and exact ranges through reference service", async () => {
  const f = fixture();
  const read = { asset: { path: `liteasy://literal/data?scope=${f.scopeId}`, title: "JSON note", kind: "note", revision: "r1", capabilities: ["read" as const] },
    text: '{"nodes":[],"edges":[]}', offset: 0, totalCharacters: 23, truncated: false };
  const { sourceContent } = await import("../app/features/markdown/contentStructure");
  const content = sourceContent({ text: read.text, path: read.asset.path, revision: "r1", scopeId: f.scopeId, profile: "literal/v1" });
  f.assets.registerAdapter({ id: "literal", accepts: path => path === read.asset.path, stat: async () => read.asset, search: async () => [], read: async () => ({ ...read, content }) });
  const service = createResourceReferenceService({ scope: f.scopeId, assets: f.assets, active: () => true, catalog: () => [] });
  expect((await service.document(read.asset.path)).content).toBe(content);
  const presentation = await service.present(read.asset.path);
  expect(presentation.kind === "content" && presentation.read.content).toBe(content);
  f.hook.unmount();
});

test("selected placements keep their exact versions, internal edges and frozen geometry across later board edits", async () => {
  const f = fixture();
  let board = await f.repository.create({ kind: "workspace.board", title: "Selected scene", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  const note = await f.repository.create({ kind: "content.note", title: "Shared", content: { schema: "liteasy.note/v1", payload: { text: "old revision", origin: "user" } } });
  const newer = await f.repository.editNote(refOf(note), "new revision");
  const other = await f.repository.create({ kind: "content.note", title: "Outside", content: { schema: "liteasy.note/v1", payload: { text: "not selected", origin: "user" } } });
  await f.repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(note), refOf(newer), refOf(other)] });
  board = await f.repository.resolveLatest(board.objectId);
  const placements = await f.repository.listPlacements(board.objectId);
  const members = placements.filter(row => row.ref.objectId === note.objectId);
  await f.repository.connectPlacements({ boardRef: refOf(board), operationId: crypto.randomUUID(), from: { ...members[0], side: "right" }, to: { ...members[1], side: "left" } });
  board = await f.repository.resolveLatest(board.objectId);
  const path = liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(board), selectorId: `placements:${placements.filter(row => row.ref.objectId === note.objectId).map(row => row.placementId).join(",")}` } });
  const [attachment] = await f.assets.context(path);
  expect(attachment.refs).toHaveLength(3); expect(attachment.ref.selectorId).toMatch(/^board-context:/);
  const fixedPath = liteasyPath(f.scopeId, { kind: "object", ref: attachment.ref });
  const selected = await f.assets.present(fixedPath);
  expect(selected.kind).toBe("board");
  if (selected.kind !== "board") throw new Error("Expected board");
  expect(selected.scene.members.map(row => row.placement.ref)).toEqual(expect.arrayContaining([refOf(note), refOf(newer)]));
  expect(selected.scene.edges).toHaveLength(1);
  await f.repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(other)] });
  const reopened = await f.assets.present(fixedPath);
  expect(reopened).toEqual(selected);
  f.hook.unmount();
});

test("empty boards and user-authored JSON code keep distinct registered presentations", async () => {
  const f = fixture();
  const board = await f.repository.create({ kind: "workspace.board", title: "Empty", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  const note = await f.repository.create({ kind: "content.note", title: "Code", content: { schema: "liteasy.note/v1", payload: { text: '```json\n{"nodes":[],"edges":[]}\n```', origin: "user" } } });
  const service = createResourceReferenceService({ scope: f.scopeId, assets: f.assets, active: () => true, catalog: () => [] });
  render(<ResourceReferencesContext.Provider value={{ service, open: vi.fn(), capture: vi.fn(), suggestions: [] }}>
    <ResourceReferenceView locator={liteasyPath(f.scopeId, { kind: "object", ref: refOf(board) })} />
    <ResourceReferenceView locator={liteasyPath(f.scopeId, { kind: "object", ref: refOf(note) })} />
  </ResourceReferencesContext.Provider>);
  expect(await screen.findByText("空白白板")).toBeVisible();
  expect(await screen.findByText('{"nodes":[],"edges":[]}')).toBeVisible();
  expect(screen.getAllByLabelText("白板空间预览")).toHaveLength(1);
  f.hook.unmount();
});

test("a concurrent layout edit rejects the complete scene instead of mixing heads", async () => {
  const f = fixture();
  const board = await f.repository.create({ kind: "workspace.board", title: "Concurrent", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  const note = await f.repository.create({ kind: "content.note", title: "Later", content: { schema: "liteasy.note/v1", payload: { text: "later", origin: "user" } } });
  const list = f.repository.listPlacements.bind(f.repository);
  vi.spyOn(f.repository, "listPlacements").mockImplementationOnce(async id => {
    const before = await list(id);
    await f.repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(note)] });
    return before;
  });
  await expect(f.assets.present(liteasyPath(f.scopeId, { kind: "object", ref: refOf(board) }))).rejects.toMatchObject({ code: "revision_unavailable" });
  f.hook.unmount();
});
