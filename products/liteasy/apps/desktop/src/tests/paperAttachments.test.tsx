import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { usePaperAttachmentController } from "../app/controllers/usePaperAttachmentController";
import { objectText, refOf } from "../app/features/objects/object.types";
import { createAgentAssetNavigator } from "../app/controllers/agent/createAgentAssetNavigator";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { createNoteFileService } from "../app/features/note-files/noteFileService";
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
test("attachment editor saves Markdown revisions and preserves the draft when another editor changes the note", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope), projects = createPaperProjectRepository(storage, scope);
  const openEditor = vi.fn(), openBoard = vi.fn();
  const { result } = renderHook(() => usePaperAttachmentController({ repository, projects, openEditor, openBoard }));
  const paper = { id: "p", title: "Paper" };
  await act(async () => { await result.current.create(paper, "note", "实验笔记"); });
  expect(openEditor).toHaveBeenCalledOnce();
  act(() => result.current.setDraft("# 实验\n\n$$x^2$$"));
  await act(async () => { await result.current.save(); });
  const project = await projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
  const asset = (await projects.listAssets(project.projectId))[0];
  expect(objectText(await repository.get(asset.ref!))).toContain("$$x^2$$");
  const original = result.current.session!.object;
  await repository.editNote(refOf(original), "另一个编辑器的内容");
  act(() => result.current.setDraft("当前窗口未保存的想法"));
  await act(async () => { await result.current.save(); });
  expect(result.current.error).toContain("草稿仍保留");
  expect(result.current.session!.draft).toBe("当前窗口未保存的想法");
  expect(objectText(await repository.resolveLatest(original.objectId))).toBe("另一个编辑器的内容");
  await act(async () => { await result.current.create(paper, "board", "实验画布"); });
  expect(openBoard).toHaveBeenCalledWith(expect.objectContaining({ kind: "workspace.board", title: "实验画布" }));
  expect(await projects.listAssets(project.projectId)).toHaveLength(2);
});

test("opening an Agent write receipt refreshes a clean paper note and preserves a local unsaved draft", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope), projects = createPaperProjectRepository(storage, scope);
  const { result } = renderHook(() => usePaperAttachmentController({ repository, projects, openEditor: vi.fn(), openBoard: vi.fn() }));
  const paper = { id: "cicada", title: "Cicada" };
  await act(async () => { await result.current.create(paper, "note", "CicN"); });
  const original = result.current.session!.object;
  const saved = await repository.editNote(refOf(original), "# CicN\n\n已保存的论文要义");
  const navigate = createAgentAssetNavigator({ repository, projects, files: createNoteFileService(scope, () => scope),
    active: () => true, getPapers: () => [paper], openAttachment: (...args) => result.current.open(...args),
    openObject: vi.fn(), openFile: vi.fn(), openPaper: vi.fn(), openArtifact: vi.fn() });
  const path = liteasyPath(scope, { kind: "object", ref: refOf(saved), followLatest: true });
  await act(async () => { await navigate(path); });
  expect(result.current.session!.draft).toContain("已保存的论文要义");
  act(() => result.current.setDraft("我尚未保存的补充"));
  await repository.editNote(refOf(saved), "另一次已保存的更新");
  await act(async () => { await navigate(path); });
  expect(result.current.session!.draft).toBe("我尚未保存的补充");
  await expect(navigate(path.replace(`scope=${scope}`, "scope=another-user"))).rejects.toThrow("账户");
});
