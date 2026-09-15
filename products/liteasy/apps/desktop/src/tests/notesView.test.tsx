import "fake-indexeddb/auto";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { describe, expect, it, vi } from "vitest";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf } from "../app/features/objects/object.types";
import { createNotesRepository } from "../app/features/notes/notesRepository";
import { NotesPanel } from "../app/features/notes/NotesPanel";
import { useNotesController } from "../app/controllers/useNotesController";
import { loadPdfNotes } from "../app/features/notes/pdfNotesSource";
import { pdfAnnotationStorageKey } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import { artifactAnnotationNotes } from "../app/features/notes/artifactNotesSource";
import type { AgentArtifactResult } from "../app/features/artifacts/artifact.types";

function fixture() {
  const scope = `notes-${crypto.randomUUID()}`;
  let currentScope = scope;
  const storage = createObjectStorage(scope, () => currentScope);
  const repository = createObjectRepository(storage, scope);
  return {
    scope,
    storage,
    repository,
    notes: createNotesRepository(storage),
    switchScope() {
      currentScope = `other-${crypto.randomUUID()}`;
      return currentScope;
    },
    restart() {
      return createNotesRepository(
        createObjectStorage(scope, () => currentScope),
      );
    },
    input: {
      scopeId: scope,
      repository,
      visible: true,
      getPapers: () => [],
      onOpen: vi.fn(),
      openObject: vi.fn(),
      openAnnotation: vi.fn(),
    },
  };
}
const note = (text: string) => ({
  kind: "content.note" as const,
  title: text,
  content: {
    schema: "liteasy.note/v1" as const,
    payload: { text, origin: "user" as const },
  },
});

describe("Notes reference directories", () => {
  it("enforces sibling folder names atomically for simultaneous root and default creations", async () => {
    const f = fixture();
    for (const parentId of ["root", "default/paper"]) {
      const attempts = await Promise.allSettled([
        f.notes.createFolder(parentId, "专题"),
        f.restart().createFolder(parentId, "专题"),
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (await f.notes.listFolders()).filter(
          (folder) => folder.parentId === parentId && folder.name === "专题",
        ),
      ).toHaveLength(1);
    }
  });
  it("copies references across persistent directories without copying or mutating sources", async () => {
    const f = fixture();
    const object = await f.repository.create(note("用户正文"));
    const folder = await f.notes.createFolder("root", "我的研究");
    const child = await f.notes.createFolder(folder.folderId, "方法");
    const target = {
      kind: "object" as const,
      ref: refOf(object),
      followLatest: true,
    };
    const first = await f.notes.collect(target, folder.folderId);
    await f.notes.collect(target, child.folderId);
    await f.notes.collect(target, folder.folderId);
    expect(await f.restart().listReferences()).toHaveLength(2);
    expect((await f.repository.search()).objects).toHaveLength(1);
    expect(await f.repository.resolveLatest(object.objectId)).toEqual(object);
    const stored = await f.storage.list("notes/");
    expect(JSON.stringify(stored)).not.toContain("用户正文");
    await f.notes.removeReference(first.entryId);
    expect(await f.repository.get(refOf(object))).toEqual(object);
    await expect(f.notes.removeFolder(folder.folderId)).rejects.toThrow(
      "子目录",
    );
    await expect(f.notes.removeFolder("default/paper")).rejects.toThrow(
      "默认目录",
    );
  });

  it("isolates references per account and rejects writes from a switched-away view", async () => {
    const f = fixture();
    await f.notes.collect(
      { kind: "pdf-annotation", paperId: "paper", annotationId: "annotation" },
      "default/paper",
    );
    const otherScope = f.switchScope();
    const other = createNotesRepository(
      createObjectStorage(otherScope, () => otherScope),
    );
    expect(await other.listReferences()).toEqual([]);
    await expect(
      f.notes.createFolder("root", "旧账号目录"),
    ).rejects.toMatchObject({ code: "object_forbidden" });
    await expect(f.restart().listReferences()).rejects.toMatchObject({
      code: "object_forbidden",
    });
  });

  it("retains immutable artifact references while user-note views follow later edits", async () => {
    const f = fixture();
    const object = await f.repository.create(note("初稿"));
    const artifact = await f.repository.create({
      kind: "artifact.document",
      title: "薄读的一页",
      content: {
        schema: "liteasy.document/v1",
        payload: {
          blocks: [
            {
              blockId: "page",
              type: "markdown",
              text: "系统生成内容",
              sourceRefs: [],
            },
          ],
        },
      },
    });
    const folder = await f.notes.createFolder("root", "专题");
    const { result } = renderHook(() => useNotesController(f.input));
    await waitFor(() => expect(result.current.model.items).toHaveLength(1));
    await act(async () => {
      await result.current.port.collect(
        { kind: "object", ref: refOf(object) },
        folder.folderId,
      );
      await result.current.port.collect(
        { kind: "object", ref: refOf(artifact) },
        folder.folderId,
      );
    });
    const entries = await f.notes.listReferences();
    expect(result.current.model.items.every((item) => !item.entryId)).toBe(
      true,
    );
    act(() => result.current.model.selectFolder(folder.folderId));
    expect(
      result.current.model.items.every((item) => Boolean(item.entryId)),
    ).toBe(true);
    expect(
      entries.find(
        (entry) =>
          entry.target.kind === "object" &&
          entry.target.ref.objectId === artifact.objectId,
      )?.target,
    ).toMatchObject({ followLatest: false });
    await act(async () => {
      await f.repository.editNote(refOf(object), "修订正文");
    });
    await waitFor(() =>
      expect(
        result.current.model.items.some((item) => item.text === "修订正文"),
      ).toBe(true),
    );
    expect(
      result.current.model.items.find(
        (item) => item.object?.objectId === artifact.objectId,
      )?.editable,
    ).toBe(false);
    expect(await f.repository.get(refOf(artifact))).toEqual(artifact);
    expect((await f.repository.search()).objects).toHaveLength(2);
  });

  it("automatically maps board user notes and keeps unavailable collected sources manageable", async () => {
    const f = fixture();
    const board = await f.repository.create({
      kind: "workspace.board",
      title: "读书研究",
      content: { schema: "liteasy.board/v1", payload: { description: "" } },
    });
    const refs = await f.repository.createAndPlace({
      boardRef: refOf(board),
      operationId: crypto.randomUUID(),
      draft: note("白板观点"),
    });
    await f.notes.collect(
      { kind: "object", ref: refs[0], followLatest: true },
      "root",
    );
    const { result } = renderHook(() => useNotesController(f.input));
    await waitFor(() =>
      expect(result.current.model.items[0]?.defaultFolderId).toBe(
        "default/board",
      ),
    );
    expect(
      result.current.model.items.find(
        (item) => item.object?.objectId === refs[0].objectId,
      )?.source,
    ).toContain("读书研究");
    await act(async () => {
      await f.repository.setLifecycle(refs[0], "tombstoned");
    });
    await waitFor(() =>
      expect(
        result.current.model.items.find((item) => item.unavailable)
          ?.unavailable,
      ).toBe(true),
    );
    await act(async () => {
      await result.current.model.removeReference(
        result.current.model.items.find((item) => item.unavailable)!,
      );
    });
    expect(await f.notes.listReferences()).toEqual([]);
  });

  it("allows nested folder creation and reference organization from the Notes UI", async () => {
    const f = fixture();
    await f.repository.create(note("可组织的文字"));
    function Harness() {
      const { model } = useNotesController(f.input);
      return (
        <FluentProvider theme={webLightTheme}>
          <NotesPanel model={model} />
        </FluentProvider>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "查看笔记 可组织的文字" });
    await user.click(screen.getByRole("button", { name: "新建目录" }));
    await user.type(
      screen.getByRole("textbox", { name: "目录名称" }),
      "我的专题",
    );
    await user.click(
      screen.getByRole("button", { name: "创建目录", exact: true }),
    );
    await screen.findByRole("button", { name: "我的专题", exact: true });
    await user.click(screen.getByRole("button", { name: "Note", exact: true }));
    await user.click(
      await screen.findByRole("button", { name: "查看笔记 可组织的文字" }),
    );
    await user.click(
      screen.getByRole("button", { name: "复制引用到目录", exact: true }),
    );
    const folder = (await f.notes.listFolders()).find(
      (item) => item.name === "我的专题",
    )!;
    await user.selectOptions(
      screen.getByRole("combobox", { name: "复制引用到目录" }),
      folder.folderId,
    );
    await user.click(
      screen.getByRole("button", { name: "复制引用", exact: true }),
    );
    await waitFor(async () =>
      expect(await f.notes.listReferences()).toHaveLength(1),
    );
    await user.click(
      screen.getByRole("button", { name: "我的专题", exact: true }),
    );
    await screen.findByRole("button", { name: "查看笔记 可组织的文字" });
    expect((await f.repository.search()).objects).toHaveLength(1);
  });
});

describe("native Notes sources", () => {
  it("reads PDF user comments and text boxes without moving or rewriting annotation state", async () => {
    const paper = { id: crypto.randomUUID(), title: "来源论文" };
    const now = new Date().toISOString();
    const base = {
      createdAt: now,
      updatedAt: now,
      excerpt: "原文",
      text: "原文",
      page: 1,
      paperIdentity: resolvePaperIdentity(paper),
      rects: [],
      revision: 1,
      publication: { state: "not_published", desiredVisibility: "private" },
    };
    const annotations = [
      { ...base, id: "comment", kind: "highlight", note: "自己的判断" },
      { ...base, id: "plain-highlight", kind: "highlight" },
      { ...base, id: "textbox", kind: "text", note: "文本框内容" },
    ];
    const key = pdfAnnotationStorageKey(paper)!;
    const snapshot = JSON.stringify(annotations);
    localStorage.setItem(key, snapshot);
    const items = await loadPdfNotes([paper]);
    expect(
      items.filter((item) => item.automaticallyListed).map((item) => item.text),
    ).toEqual(["自己的判断", "文本框内容"]);
    expect(items.find((item) => item.title === "自己的判断")?.target).toEqual({
      kind: "pdf-annotation",
      paperId: paper.id,
      annotationId: "comment",
    });
    expect(localStorage.getItem(key)).toBe(snapshot);
    expect(items.every((item) => !item.editable)).toBe(true);
  });

  it("maps thin-reading comments by native identity without changing generated nodes", () => {
    const artifact = {
      artifactId: "artifact",
      title: "薄读",
      thinReadingDocument: {
        annotations: [
          {
            id: "comment",
            artifactId: "artifact",
            nodeId: "page",
            body: "我的薄读批注",
            updatedAt: "2026-09-14T00:00:00.000Z",
          },
        ],
        nodes: { page: { title: "一页", summary: "系统正文" } },
      },
    } as unknown as AgentArtifactResult;
    const before = JSON.stringify(artifact);
    const items = artifactAnnotationNotes([artifact]);
    expect(items[0].target).toEqual({
      kind: "artifact-annotation",
      artifactId: "artifact",
      annotationId: "comment",
    });
    expect(items[0]).toMatchObject({
      text: "我的薄读批注",
      editable: false,
      automaticallyListed: true,
    });
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
