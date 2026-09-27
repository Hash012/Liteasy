import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useAssistantContextCatalog } from "../app/controllers/useAssistantContextCatalog";
import type { PaperProjectsController } from "../app/controllers/usePaperProjectsController";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import type { ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import { contextAttachments } from "../app/features/resource-filesystem/resourceContext";
import { resolveContextSnapshot } from "../app/features/context/objectContext";
import { readObjectTransfer } from "../app/features/object-transfer/objectTransfer";
import { objectText, refOf } from "../app/features/objects/object.types";
import { stageImage } from "../app/features/objects/objectAssets";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { describeObjectSetting } from "../app/features/settings/settingsRegistry";
import { readObjectContextPreview } from "../app/features/assistant/contextAssetPreview";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
function setup() {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope);
  const projects = createPaperProjectRepository(storage, scope);
  const port = { receiveContextDrop: async (data) => contextAttachments(repository, readObjectTransfer(data)!.refs, () => true) } as ObjectWorkbenchPort;
  return { scope, storage, repository, projects, port };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("new reading files appear in the same context catalog without opening the object workbench", async () => {
  const env = setup();
  const { result } = renderHook(() => useAssistantContextCatalog({ artifacts: [], objects: [], repository: env.repository, port: env.port }));
  const reading = createReadingLibraryRepository(env.storage, env.scope);
  await act(async () => {
    await reading.importFile("chapter.txt", new TextEncoder().encode("actual file"), { format: "text", title: "研究方法手册", authors: [],
      chapters: [{ id: "one", title: "第一章", content: "实际章节正文", plainText: "实际章节正文", format: "text" }], toc: [], resources: [], warnings: [] });
  });
  await waitFor(() => expect(result.current.find((item) => item.label === "研究方法手册")?.category).toBe("阅读文件"));
  const token = await result.current.find((item) => item.label === "研究方法手册")!.resolveToken!();
  const snapshot = await resolveContextSnapshot({ repository: env.repository, refs: token.contextRefs!, purpose: "阅读" });
  expect(snapshot.entries[0].text).toContain("实际章节正文");
});

test("project candidates pin cross-paper sources, preview real text and create an independent editable copy", async () => {
  const env = setup();
  const first = await env.projects.ensurePaperProject({ paperId: "a", title: "论文 A" });
  const second = await env.projects.ensurePaperProject({ paperId: "b", title: "论文 B" });
  const source = await env.projects.registerSource(first.projectId, { assetId: "text:1", kind: "text", paperId: "a", title: "A 原文", text: "不可改写的结论", page: 1 });
  await env.projects.addAsset(second.projectId, { ...source, assetId: "reference-a", role: "reference" });
  const catalog = await Promise.all([first, second].map(async (project) => ({ project, assets: await env.projects.listAssets(project.projectId) })));
  const projectController = { catalog, repository: env.projects, error: "", busy: false, refresh: vi.fn(),
    createNote: (projectId, text) => env.projects.createNote(projectId, text),
    createEditableCopy: (projectId, ref) => env.projects.createEditableCopy(projectId, ref),
  } satisfies PaperProjectsController;
  const { result } = renderHook(() => useAssistantContextCatalog({ artifacts: [], objects: [], repository: env.repository, port: env.port, projects: projectController }));
  const asset = result.current.find((item) => item.projectId === first.projectId && item.category === "原文")!;
  expect(asset.readOnly).toBe(true);
  expect((await asset.loadPreview!()).text).toBe("不可改写的结论");
  const firstToken = await result.current.find((item) => item.category === "项目" && item.projectId === first.projectId)!.resolveToken!();
  const secondToken = await result.current.find((item) => item.category === "项目" && item.projectId === second.projectId)!.resolveToken!();
  const snapshot = await resolveContextSnapshot({ repository: env.repository, refs: [...firstToken.contextRefs!, ...secondToken.contextRefs!], purpose: "跨项目比较" });
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.entries[0].ref).toEqual(source.ref);
  let copied;
  await act(async () => { copied = await asset.createEditableCopy!(); });
  const copiedObject = await env.repository.get(copied!.contextRefs![0] as typeof source.ref & {});
  expect(copiedObject.kind).toBe("content.note");
  expect(copiedObject.provenance.derivedFrom).toEqual([source.ref]);
  expect(refOf(await env.repository.get(source.ref!))).toEqual(source.ref);
});

test("scope changes hide old title metadata and objects in the very first render", async () => {
  const first = setup();
  const second = setup();
  const object = await first.repository.create({ kind: "content.note", title: "旧账号私有笔记", content: { schema: "liteasy.note/v1", payload: { text: "私有正文", origin: "user" } } });
  const project = await first.projects.ensurePaperProject({ paperId: "old-paper", title: "旧账号论文项目" });
  const projects = { catalog: [{ project, assets: [] }], repository: first.projects, error: "", busy: false, refresh: vi.fn(),
    createNote: first.projects.createNote, createEditableCopy: first.projects.createEditableCopy } satisfies PaperProjectsController;
  const renders: Array<{ scope: string; labels: string[] }> = [];
  const hook = renderHook(({ env }) => {
    const candidates = useAssistantContextCatalog({ artifacts: [], objects: [object], repository: env.repository, port: env.port, papers: [], projects });
    renders.push({ scope: env.scope, labels: candidates.map((candidate) => candidate.label) });
    return candidates;
  }, { initialProps: { env: first } });
  await waitFor(() => expect(hook.result.current.some((candidate) => candidate.label === "旧账号私有笔记")).toBe(true));
  hook.rerender({ env: second });
  expect(renders.filter((render) => render.scope === second.scope).every((render) => !render.labels.includes("旧账号私有笔记"))).toBe(true);
  expect(renders.filter((render) => render.scope === second.scope).every((render) => !render.labels.includes("旧账号论文项目"))).toBe(true);
  hook.unmount();
});

test("late metadata scans cannot overwrite a newer list after an object is saved", async () => {
  const env = setup();
  const delayed = deferred<Awaited<ReturnType<typeof env.repository.searchTitles>>>();
  vi.spyOn(env.repository, "searchTitles").mockImplementationOnce(() => delayed.promise);
  const hook = renderHook(() => useAssistantContextCatalog({ artifacts: [], objects: [], repository: env.repository, port: env.port }));
  await act(async () => { await env.repository.create({ kind: "content.note", title: "新保存的笔记", content: { schema: "liteasy.note/v1", payload: { text: "新正文", origin: "user" } } }); });
  await waitFor(() => expect(hook.result.current.some((candidate) => candidate.label === "新保存的笔记")).toBe(true));
  await act(async () => { delayed.resolve([]); });
  expect(hook.result.current.some((candidate) => candidate.label === "新保存的笔记")).toBe(true);
  hook.unmount();
});

test("a selected asset finishing after account switch cannot attach to the next account", async () => {
  const first = setup();
  const second = setup();
  const object = await first.repository.create({ kind: "content.note", title: "旧账号笔记", content: { schema: "liteasy.note/v1", payload: { text: "旧内容", origin: "user" } } });
  const delayed = deferred<Awaited<ReturnType<NonNullable<ObjectWorkbenchPort["receiveContextDrop"]>>>>();
  const receive = vi.fn(() => delayed.promise);
  const hook = renderHook(({ env, port }) => useAssistantContextCatalog({ artifacts: [], objects: [], repository: env.repository, port }), { initialProps: { env: first, port: { ...first.port, receiveContextDrop: receive } } });
  await waitFor(() => expect(hook.result.current.some((candidate) => candidate.label === object.title)).toBe(true));
  const pending = hook.result.current.find((candidate) => candidate.label === object.title)!.resolveToken!();
  const rejection = expect(pending).rejects.toThrow("账号已切换");
  await waitFor(() => expect(receive).toHaveBeenCalledOnce());
  hook.rerender({ env: second, port: { ...second.port, receiveContextDrop: receive } });
  await act(async () => { delayed.resolve(await contextAttachments(first.repository, [refOf(object)], () => true)); });
  await rejection;
  hook.unmount();
});

test("derived notes use their latest revision while shared references keep the chosen original revision", async () => {
  const env = setup();
  const first = await env.projects.ensurePaperProject({ paperId: "a", title: "论文 A" });
  const second = await env.projects.ensurePaperProject({ paperId: "b", title: "论文 B" });
  const note = await env.projects.createNote(first.projectId, "原始理解", "研究笔记");
  await env.projects.addAsset(second.projectId, { ...note, role: "reference" });
  const updated = await env.repository.editNote(note.ref!, "修订后的理解");
  const catalog = await Promise.all([first, second].map(async (project) => ({ project, assets: await env.projects.listAssets(project.projectId) })));
  const controller = { catalog, repository: env.projects, error: "", busy: false, refresh: vi.fn(), createNote: env.projects.createNote, createEditableCopy: env.projects.createEditableCopy } satisfies PaperProjectsController;
  const hook = renderHook(() => useAssistantContextCatalog({ artifacts: [], objects: [], repository: env.repository, port: env.port, projects: controller }));
  const latest = hook.result.current.find((candidate) => candidate.projectId === first.projectId && candidate.category === "笔记")!;
  const pinned = hook.result.current.find((candidate) => candidate.projectId === second.projectId && candidate.category === "笔记")!;
  expect((await latest.loadPreview!()).text).toBe("修订后的理解");
  expect((await pinned.loadPreview!()).text).toBe("原始理解");
  const latestToken = await latest.resolveToken!();
  const pinnedToken = await pinned.resolveToken!();
  expect(latestToken.contextRefs).toEqual([refOf(updated)]);
  expect(pinnedToken.contextRefs).toEqual([note.ref]);
  expect(objectText(await env.repository.get(note.ref!))).toBe("原始理解");
  hook.unmount();
});

test("setting previews follow current values and match the content passed to the assistant", async () => {
  const env = setup();
  const settings = { ...createSettingsStore().getState(), "view.font_size": "18" };
  const hook = renderHook(({ settings }) => useAssistantContextCatalog({ artifacts: [], objects: [], repository: env.repository, port: env.port, settings }), { initialProps: { settings } });
  await act(async () => {});
  const candidate = hook.result.current.find((item) => item.id === "setting-view.font_size")!;
  expect(candidate.preview).toContain("界面字号：18");
  const snapshot = await resolveContextSnapshot({ repository: env.repository, refs: candidate.token!.contextRefs!, purpose: "说明设置", persist: false,
    describeSetting: (key) => describeObjectSetting(key, settings) });
  expect(snapshot.entries[0].text).toBe(candidate.preview);
  hook.rerender({ settings: { ...settings, "view.font_size": "24" } });
  expect(hook.result.current.find((item) => item.id === candidate.id)!.preview).toContain("界面字号：24");
  expect(hook.result.current.some((item) => item.id === "setting-models.direct_endpoint")).toBe(false);
  hook.unmount();
});

test("image previews read actual bytes lazily for both project sources and saved copies without writing", async () => {
  const env = setup();
  const project = await env.projects.ensurePaperProject({ paperId: "a", title: "论文 A" });
  const image = await stageImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]), "image/png");
  const source = await env.projects.registerSource(project.projectId, { assetId: "figure:1", paperId: "a", title: "实验装置", kind: "image", text: "图 1：实验装置说明", assets: [image] });
  const copy = await env.projects.createEditableCopy(project.projectId, source.ref!);
  const object = await env.repository.get(copy.ref!);
  const projects = { catalog: [{ project, assets: [source] }], repository: env.projects, error: "", busy: false, refresh: vi.fn(), createNote: env.projects.createNote, createEditableCopy: env.projects.createEditableCopy } satisfies PaperProjectsController;
  const read = vi.spyOn(env.repository, "readAsset");
  const write = vi.spyOn(env.storage, "commit");
  const hook = renderHook(() => useAssistantContextCatalog({ artifacts: [], objects: [object], repository: env.repository, port: env.port, projects }));
  await act(async () => {});
  expect(read).not.toHaveBeenCalled();
  for (const candidate of hook.result.current.filter((item) => item.category === "图片" || item.id === `saved-${object.objectId}`)) {
    const preview = await candidate.loadPreview!();
    expect(preview.text).toContain("实验装置说明");
    expect(preview.images).toEqual([{ url: `data:image/png;base64,${image.base64}`, label: candidate.label }]);
  }
  expect(read).toHaveBeenCalledTimes(2);
  expect(write).not.toHaveBeenCalled();
  hook.unmount();
});

test("board previews include member content without creating a snapshot or changing membership", async () => {
  const env = setup();
  const note = await env.repository.create({ kind: "content.note", title: "实验记录", content: { schema: "liteasy.note/v1", payload: { text: "需要核对对照组结果", origin: "user" } } });
  const board = await env.repository.create({ kind: "workspace.board", title: "研究白板", content: { schema: "liteasy.board/v1", payload: { description: "实验计划" } } });
  await env.repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(note)] });
  const save = vi.spyOn(env.repository, "saveSnapshot");
  const hook = renderHook(() => useAssistantContextCatalog({ artifacts: [], objects: [board], repository: env.repository, port: env.port }));
  await act(async () => {});
  const preview = await hook.result.current.find((item) => item.label === "研究白板")!.loadPreview!();
  expect(preview.text).toContain("1 个元素、0 条连接");
  expect(preview.text).toContain("需要核对对照组结果");
  expect(save).not.toHaveBeenCalled();
  expect(await env.repository.listPlacements(board.objectId)).toHaveLength(1);
  hook.unmount();
});

test("saved excerpt previews include the original quote that accompanies the user's comment", async () => {
  const env = setup();
  const note = await env.repository.create({ kind: "content.note", title: "来源", content: { schema: "liteasy.note/v1", payload: { text: "实验样本共 128 个", origin: "user" } } });
  const fragment = await env.repository.create({ kind: "content.fragment", title: "样本批注", content: { schema: "liteasy.fragment/v1", payload: {
    text: "需要核对样本量", partial: false, anchors: [{ type: "text", sourceRef: refOf(note), blockId: "body", quote: { exact: "实验样本共 128 个", prefix: "", suffix: "" } }],
  } } });
  const preview = await readObjectContextPreview(env.repository, fragment, () => {});
  const snapshot = await resolveContextSnapshot({ repository: env.repository, refs: [refOf(fragment)], purpose: "检查批注", persist: false });
  expect(preview.text).toBe(snapshot.entries[0].text);
  expect(preview.text).toContain("实验样本共 128 个");
});
