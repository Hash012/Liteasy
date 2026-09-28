import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { objectText, refOf } from "../app/features/objects/object.types";
import { stageImage } from "../app/features/objects/objectAssets";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { resolveContextSnapshot } from "../app/features/context/objectContext";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });

function fixture() {
  let currentScope = crypto.randomUUID();
  const scopeId = currentScope;
  const storage = createObjectStorage(scopeId, () => currentScope);
  return {
    scopeId,
    storage,
    objects: createObjectRepository(storage, scopeId),
    projects: createPaperProjectRepository(storage, scopeId),
    reopen: () => createPaperProjectRepository(createObjectStorage(scopeId, () => currentScope), scopeId),
    switchAccount: () => { currentScope = crypto.randomUUID(); },
  };
}

test("paper projects have stable scoped identities and concurrent creation creates one compact record", async () => {
  const f = fixture();
  const input = { paperId: "paper:/研究 A", title: "第一篇论文" };
  const projects = await Promise.all(Array.from({ length: 6 }, () => f.projects.ensurePaperProject(input)));
  expect(new Set(projects.map((project) => project.projectId)).size).toBe(1);
  expect(await f.reopen().listProjects()).toEqual([projects[0]]);
  expect(await f.storage.list("head/", "", 1000)).toEqual([]);
  const renamed = await f.projects.ensurePaperProject({ ...input, title: "更新标题" });
  expect(renamed.projectId).toBe(projects[0].projectId);
  expect(renamed.createdAt).toBe(projects[0].createdAt);
  const otherAccount = createPaperProjectRepository(f.storage, "other-account");
  expect(await otherAccount.listProjects()).toEqual([]);
  await expect(otherAccount.listAssets(projects[0].projectId)).rejects.toMatchObject({ code: "object_not_found" });
  const other = await otherAccount.ensurePaperProject(input);
  expect(other.projectId).not.toBe(projects[0].projectId);
});

test("recognized text remains read-only and editable copies preserve pinned provenance and original meaning", async () => {
  const f = fixture();
  const project = await f.projects.ensurePaperProject({ paperId: "paper-a", title: "研究 A" });
  const sourceInput = { paperId: "paper-a", assetId: "text:page:2", title: "第 2 页原文", kind: "text" as const, text: "论文原始结论", page: 2, documentHash: "original-pdf" };
  const source = await f.projects.registerSource(project.projectId, sourceInput);
  const same = await f.projects.registerSource(project.projectId, sourceInput);
  expect(same).toEqual(source);
  expect((await f.objects.get(source.ref!)).paperAnchors?.[0]).toMatchObject({
    source: { paperId: "paper-a", documentHash: "original-pdf" },
    locator: { page: 2, precision: "page" },
    snapshot: { quote: "论文原始结论" },
  });
  await expect(f.objects.editNote(source.ref!, "改写结论")).rejects.toMatchObject({ code: "capability_denied" });
  await expect(f.projects.addAsset(project.projectId, { ...source, title: "修改来源" })).rejects.toMatchObject({ code: "capability_denied" });
  await expect(f.projects.addAsset(project.projectId, { ...source, role: "derived" })).rejects.toMatchObject({ code: "capability_denied" });
  const copy = await f.projects.createEditableCopy(project.projectId, source.ref!);
  expect(await f.projects.createEditableCopy(project.projectId, source.ref!)).toEqual(copy);
  const copyObject = await f.objects.get(copy.ref!);
  expect(copyObject.provenance).toMatchObject({ sourceRefs: [source.ref], derivedFrom: [source.ref] });
  expect(copyObject.kind === "content.note" && copyObject.content.payload.origin).toBe("derived");
  await f.objects.editNote(copy.ref!, "我的补充解释");
  expect(objectText(await f.objects.get(source.ref!))).toBe("论文原始结论");
  expect(await f.objects.listRelations(copy.ref!, { predicate: "derived_from" })).toHaveLength(1);
  const rerecognized = await f.projects.registerSource(project.projectId, { ...sourceInput, text: "重新识别的原始结论" });
  expect(rerecognized.ref!.objectId).toBe(source.ref!.objectId);
  expect(rerecognized.ref!.revision).not.toBe(source.ref!.revision);
  expect(objectText(await f.objects.get(source.ref!))).toBe("论文原始结论");
  const snapshot = await resolveContextSnapshot({ repository: f.objects, purpose: "核对原文与副本", refs: [source.ref!, rerecognized.ref!, copy.ref!] });
  expect(snapshot.entries.map((entry) => entry.trustLabel)).toEqual(["source", "source", "derived"]);
  expect(snapshot.entries[0].paperAnchors?.[0].locator).toMatchObject({ page: 2, precision: "page" });
  expect(await f.reopen().listAssets(project.projectId)).toHaveLength(2);
});

test("recognized image bytes are verified once and remain available to editable derived copies", async () => {
  const f = fixture();
  const project = await f.projects.ensurePaperProject({ paperId: "paper-a", title: "研究 A" });
  const image = await stageImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]), "image/png");
  const sourceInput = { paperId: "paper-a", assetId: "figure:1", title: "图 1", kind: "image" as const, text: "实验装置", page: 3, assets: [image] };
  const source = await f.projects.registerSource(project.projectId, sourceInput);
  expect((await f.objects.readAsset(image.assetId)).base64).toBe(image.base64);
  const copy = await f.projects.createEditableCopy(project.projectId, source.ref!);
  const copyObject = await f.objects.get(copy.ref!);
  expect(copyObject.assets).toEqual((await f.objects.get(source.ref!)).assets);
  expect(copyObject.kind === "content.note" && copyObject.content.payload.assetIds).toEqual([image.assetId]);
  const assetVersion = (await f.storage.get(`asset/${image.assetId}`))!.version;
  await f.projects.registerSource(project.projectId, sourceInput);
  expect((await f.storage.get(`asset/${image.assetId}`))!.version).toBe(assetVersion);
  await expect(f.projects.registerSource(project.projectId, { ...sourceInput, assetId: "figure:invalid", assets: [{ ...image, byteLength: image.byteLength + 1 }] })).rejects.toMatchObject({ code: "unsupported_schema" });
  await expect(f.projects.registerSource(project.projectId, { ...sourceInput, assets: [] })).rejects.toMatchObject({ code: "capability_denied" });
  expect(await f.projects.listAssets(project.projectId)).toHaveLength(2);
});

test("cross-paper references and AI artifacts reuse assets without changing their origin", async () => {
  const f = fixture();
  const first = await f.projects.ensurePaperProject({ paperId: "paper-a", title: "研究 A" });
  const second = await f.projects.ensurePaperProject({ paperId: "paper-b", title: "研究 B" });
  const source = await f.projects.registerSource(first.projectId, { paperId: "paper-a", assetId: "text:full", title: "A 原文", kind: "text", text: "结论 A" });
  await expect(f.projects.syncSources(second.projectId, [source])).rejects.toMatchObject({ code: "capability_denied" });
  await f.projects.addAsset(second.projectId, { ...source, role: "reference" });
  const note = await f.projects.createNote(second.projectId, "跨论文比较", "A 与 B 的比较", [source.ref!], "compare-papers");
  expect(await f.projects.createNote(second.projectId, "跨论文比较", "A 与 B 的比较", [source.ref!], "compare-papers")).toEqual(note);
  const generated = await f.objects.create({ kind: "artifact.document", title: "研究大纲", runId: "run-1", sourceRefs: [source.ref!], content: { schema: "liteasy.document/v1", payload: { blocks: [] } } });
  await f.projects.addAsset(second.projectId, { assetId: "outline", title: "研究大纲", kind: "artifact", role: "derived", artifactId: "artifact-1", ref: refOf(generated) });
  await f.projects.addAsset(first.projectId, { ...note, role: "reference" });
  expect((await f.projects.listAssets(second.projectId)).find((asset) => asset.role === "reference")?.ref).toEqual(source.ref);
  expect((await f.objects.get(note.ref!)).provenance.derivedFrom).toEqual([source.ref]);
  expect(await f.projects.listAssets(first.projectId)).toHaveLength(2);
  expect(await f.projects.listAssets(second.projectId)).toHaveLength(3);
});

test("concurrent membership updates preserve every asset and listing avoids loading content bodies", async () => {
  const f = fixture();
  const project = await f.projects.ensurePaperProject({ paperId: "paper-a", title: "研究 A" });
  await Promise.all(Array.from({ length: 6 }, (_, index) => f.projects.addAsset(project.projectId, { assetId: `artifact:${index}`, title: `产物 ${index}`, kind: "artifact", role: "reference", artifactId: `artifact:${index}` })));
  const get = vi.spyOn(f.storage, "get");
  const list = vi.spyOn(f.storage, "list");
  expect(await f.projects.listAssets(project.projectId)).toHaveLength(6);
  expect(get.mock.calls.every(([key]) => key.startsWith("paper-project/"))).toBe(true);
  expect(list.mock.calls.every(([prefix]) => prefix.startsWith("paper-project/"))).toBe(true);
});

test("missing sources and account changes cannot create dangling or cross-account memberships", async () => {
  const f = fixture();
  const project = await f.projects.ensurePaperProject({ paperId: "paper-a", title: "研究 A" });
  await expect(f.projects.addAsset(project.projectId, { assetId: "missing", title: "不可用内容", kind: "note", role: "reference", ref: { objectId: "missing", revision: "missing" } })).rejects.toMatchObject({ code: "object_not_found" });
  expect(await f.projects.listAssets(project.projectId)).toEqual([]);
  f.switchAccount();
  await expect(f.projects.listProjects()).rejects.toMatchObject({ code: "object_forbidden" });
  await expect(f.projects.createNote(project.projectId, "不应写入")).rejects.toMatchObject({ code: "object_forbidden" });
});

test("title search exposes current kind and revision while accepting older compact indexes", async () => {
  const f = fixture();
  const note = await f.objects.create({ kind: "content.note", title: "旧索引笔记", content: { schema: "liteasy.note/v1", payload: { text: "正文", origin: "user" } } });
  expect(await f.objects.searchTitles()).toEqual([{ objectId: note.objectId, title: note.title, kind: note.kind, revision: note.revision }]);
  const row = (await f.storage.get(`title/${note.objectId}`))!;
  await f.storage.commit([{ key: row.key, expected: row.version, row: { ...row, value: { objectId: note.objectId, title: note.title, lifecycle: "active" } } }]);
  expect(await f.objects.searchTitles()).toEqual([{ objectId: note.objectId, title: note.title }]);
  const updated = await f.objects.editNote(refOf(note), "编辑会升级索引");
  expect(await f.objects.searchTitles()).toEqual([{ objectId: note.objectId, title: note.title, kind: note.kind, revision: updated.revision }]);
});


test("user notes and boards remain grouped under the paper after reopening without extraction", async () => {
  const f = fixture();
  const project = await f.projects.ensurePaperProject({ paperId: "unparsed-pdf", title: "尚未解析的论文" });
  const note = await f.projects.createNote(project.projectId, "# 阅读笔记\n\n$$E=mc^2$$", "我的笔记");
  const board = await f.projects.createBoard(project.projectId, "我的白板", "create-board-once");
  expect(await f.projects.createBoard(project.projectId, "我的白板", "create-board-once")).toEqual(board);
  const assets = await f.reopen().listAssets(project.projectId);
  expect(assets).toEqual(expect.arrayContaining([note, board]));
  expect(assets).toHaveLength(2);
  expect((await f.objects.get(board.ref!)).kind).toBe("workspace.board");
  expect(objectText(await f.objects.get(note.ref!))).toContain("E=mc^2");
  f.switchAccount();
  await expect(f.projects.createBoard(project.projectId, "不能跨账号创建")).rejects.toThrow();
});
