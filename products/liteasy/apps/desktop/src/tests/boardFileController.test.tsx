import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useBoardFileController } from "../app/controllers/useBoardFileController";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, objectText } from "../app/features/objects/object.types";
import type { BoardFileBinding } from "../app/features/boards/boardFileFormat";
const files = vi.hoisted(() => ({
  listMounts: vi.fn(),
  chooseFile: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  managedCanvas: undefined as undefined | ReturnType<typeof vi.fn>,
}));
vi.mock("../app/features/note-files/noteFileService", () => ({
  createNoteFileService: () => files,
  subscribeNoteFiles: () => () => undefined,
}));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.clearAllMocks();
  files.managedCanvas = undefined;
  files.listMounts.mockResolvedValue([{ id: "vault", managed: false }, { id: "managed", managed: true }]);
});

test("autosave retries a board changed during serialization without reporting a file conflict", async () => {
  const f = await fixture();
  const target = { mountId: "managed", path: "board.canvas", name: "board.canvas", version: null, text: "" };
  files.managedCanvas = vi.fn().mockResolvedValue(target);
  files.writeFile.mockImplementation(async (input) => ({ ...target, text: input.text, version: "saved" }));
  const list = f.repository.listPlacements.bind(f.repository);
  let moved = false;
  vi.spyOn(f.repository, "listPlacements").mockImplementation(async (id) => {
    const items = await list(id);
    if (!moved) {
      moved = true;
      await f.repository.applyBoardPatch({ boardRef: refOf(f.board), operationId: "during-export", move: [{ placementId: items[0].placementId, revision: items[0].revision, position: { x: 640, y: 480 } }] });
    }
    return items;
  });
  const status = vi.fn();
  const hook = renderHook(() => useBoardFileController({ repository: f.repository, board: f.board, active: () => true, select: vi.fn(), setStatus: status }));
  await waitFor(() => expect(files.writeFile).toHaveBeenCalledTimes(1), { timeout: 3500 });
  const nodes = JSON.parse(files.writeFile.mock.calls[0][0].text).nodes;
  expect(nodes[0]).toMatchObject({ x: 640, y: 480 });
  expect(status.mock.calls.some(([message]) => /变化|重试/.test(message))).toBe(false);
  hook.unmount();
});
async function fixture() {
  const scope = crypto.randomUUID();
  const repository = createObjectRepository(
    createObjectStorage(scope, () => scope),
    scope,
  );
  const note = await repository.create({
    title: "笔记",
    kind: "content.note",
    content: {
      schema: "liteasy.note/v1",
      payload: { text: "持久化内容", origin: "user" },
    },
  });
  const initial = await repository.create({
    title: "白板",
    kind: "workspace.board",
    content: { schema: "liteasy.board/v1", payload: { description: "" } },
  });
  const [ref] = await repository.applyBoardPatch({
    boardRef: refOf(initial),
    operationId: "add",
    add: [refOf(note)],
  });
  const board = await repository.get(ref);
  return { repository, board, note };
}
test("chosen board file persists across reload and autosave detects external edits without losing local placements", async () => {
  const f = await fixture();
  const target = {
    mountId: "vault",
    path: "board.canvas",
    name: "board.canvas",
    kind: "file",
    text: "",
    version: null,
  };
  files.chooseFile.mockResolvedValue(target);
  files.writeFile.mockImplementation(async (input) => ({
    ...target,
    text: input.text,
    version: "saved-v1",
  }));
  const status = vi.fn();
  const { result, rerender, unmount } = renderHook(
    ({ board }) =>
      useBoardFileController({
        repository: f.repository,
        board,
        active: () => true,
        select: vi.fn(),
        setStatus: status,
      }),
    { initialProps: { board: f.board } },
  );
  await act(async () => {
    await result.current.saveBoardFile();
  });
  expect(files.writeFile).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: null, path: "board.canvas" }),
  );
  expect(JSON.parse(files.writeFile.mock.calls[0][0].text).nodes[0].text).toBe(
    "持久化内容",
  );
  const binding = await f.repository.getBoardFileBinding<BoardFileBinding>(
    f.board.objectId,
  );
  expect(binding).toMatchObject({
    version: "saved-v1",
    savedRevision: f.board.revision,
  });
  const [placement] = await f.repository.listPlacements(f.board.objectId);
  const [next] = await f.repository.applyBoardPatch({
    boardRef: refOf(f.board),
    operationId: "move",
    move: [
      {
        placementId: placement.placementId,
        revision: placement.revision,
        position: { x: 500, y: 200 },
      },
    ],
  });
  files.writeFile.mockRejectedValueOnce(
    new Error("外部文件已变化，请重新打开或另存为"),
  );
  rerender({ board: await f.repository.get(next) });
  await waitFor(
    () =>
      expect(status).toHaveBeenCalledWith(
        expect.stringContaining("外部文件已变化"),
      ),
    { timeout: 2500 },
  );
  expect(files.writeFile.mock.calls[1][0].expectedVersion).toBe("saved-v1");
  expect(
    (await f.repository.listPlacements(f.board.objectId))[0].position,
  ).toEqual({ x: 500, y: 200 });
  expect(
    (await f.repository.getBoardFileBinding<BoardFileBinding>(f.board.objectId))
      ?.version,
  ).toBe("saved-v1");
  unmount();
});
test("neutral file resolution reuses a board and imports external changes into its identity while preserving historical note content", async () => {
  const f = await fixture();
  const select = vi.fn();
  const { result, unmount } = renderHook(() =>
    useBoardFileController({
      repository: f.repository,
      board: f.board,
      active: () => true,
      select,
      setStatus: vi.fn(),
    }),
  );
  const file = {
    mountId: "vault",
    path: "import.canvas",
    name: "import.canvas",
    version: "v1",
    text: JSON.stringify({
      nodes: [
        {
          id: "card",
          type: "text",
          x: 0,
          y: 0,
          width: 240,
          height: 120,
          text: "原内容",
        },
      ],
    }),
  };
  let initial!: Awaited<ReturnType<typeof result.current.resolveBoardFile>>;
  await act(async () => {
    initial = await result.current.resolveBoardFile(file);
  });
  expect(select).not.toHaveBeenCalled();
  const [old] = await f.repository.listPlacements(initial.objectId);
  expect(await result.current.resolveBoardFile(file)).toEqual(initial);
  const changed = {
    ...file,
    version: "v2",
    text: file.text.replace("原内容", "外部新内容"),
  };
  let updated!: typeof initial;
  await act(async () => {
    updated = await result.current.resolveBoardFile(changed);
  });
  expect(updated.objectId).toBe(initial.objectId);
  expect(updated.revision).not.toBe(initial.revision);
  expect(objectText(await f.repository.get(old.ref))).toBe("原内容");
  expect(
    objectText(
      await f.repository.get(
        (await f.repository.listPlacements(initial.objectId))[0].ref,
      ),
    ),
  ).toBe("外部新内容");
  await f.repository.applyBoardPatch({
    boardRef: updated,
    operationId: "local-edit",
    add: [refOf(f.note)],
  });
  await expect(
    result.current.resolveBoardFile({ ...changed, version: "v3" }),
  ).rejects.toThrow("都有修改");
  unmount();
});

test("new and legacy unbound boards automatically acquire a Canvas file without invoking a picker", async () => {
  const f = await fixture();
  const target = { mountId: "managed", path: "board.canvas", name: "board.canvas", text: "", version: null };
  files.managedCanvas = vi.fn().mockResolvedValue(target);
  files.writeFile.mockImplementation(async (input) => ({ ...target, text: input.text, version: "auto-v1" }));
  const status = vi.fn();
  const { result, unmount } = renderHook(() => useBoardFileController({ repository: f.repository, board: f.board,
    active: () => true, select: vi.fn(), setStatus: status }));
  await waitFor(() => expect(result.current.boardFile?.version).toBe("auto-v1"), { timeout: 2500 });
  expect(files.chooseFile).not.toHaveBeenCalled();
  expect(files.managedCanvas).toHaveBeenCalledWith(f.board.objectId);
  expect(JSON.parse(files.writeFile.mock.calls[0][0].text).nodes[0].text).toBe("持久化内容");
  expect((await f.repository.getBoardFileBinding<BoardFileBinding>(f.board.objectId))?.savedRevision).toBe(f.board.revision);
  unmount();
});

test("a recovered managed file is never silently overwritten when its binding is missing", async () => {
  const f = await fixture();
  files.managedCanvas = vi.fn().mockResolvedValue({ mountId: "managed", path: "board.canvas", name: "board.canvas", text: "external contents", version: "existing" });
  const status = vi.fn();
  const { unmount } = renderHook(() => useBoardFileController({ repository: f.repository, board: f.board,
    active: () => true, select: vi.fn(), setStatus: status }));
  await waitFor(() => expect(status).toHaveBeenCalledWith(expect.stringContaining("原文件未覆盖")), { timeout: 2500 });
  expect(files.writeFile).not.toHaveBeenCalled();
  unmount();
});

test("managed Canvas reopening and external edits preserve the logical title and physical binding", async () => {
  const f = await fixture();
  const filename = `${"a".repeat(64)}.canvas`;
  const target = { mountId: "managed", path: filename, name: filename, text: "", version: null };
  files.managedCanvas = vi.fn().mockResolvedValue(target);
  files.writeFile.mockImplementation(async (input) => ({ ...target, text: input.text, version: "managed-v1" }));
  const status = vi.fn();
  const hook = renderHook(() => useBoardFileController({ repository: f.repository, board: f.board, active: () => true, select: vi.fn(), setStatus: status }));
  await waitFor(() => expect(hook.result.current.boardFile?.version).toBe("managed-v1"), { timeout: 2500 });
  expect(hook.result.current.boardFile?.locationKind).toBe("managed");
  expect(status).toHaveBeenCalledWith("已保存 白板");
  const saved = { ...target, text: files.writeFile.mock.calls[0][0].text, version: "managed-v1" };
  await act(async () => { await hook.result.current.openBoardFile(saved); });
  expect(status).toHaveBeenLastCalledWith("已打开 白板");
  expect(await hook.result.current.resolveBoardFile(saved)).toEqual(refOf(f.board));
  let changed!: ReturnType<typeof refOf>;
  await act(async () => { changed = await hook.result.current.resolveBoardFile({ ...saved, version: "managed-v2", text: saved.text.replace("持久化内容", "外部更新正文") }); });
  expect((await f.repository.get(changed)).title).toBe("白板");
  expect(changed.objectId).toBe(f.board.objectId);
  expect(await f.repository.getBoardFileBinding(changed.objectId)).toMatchObject({ path: filename, mountId: "managed", locationKind: "managed" });
  expect(status.mock.calls.flat().join(" ")).not.toContain(filename);
  hook.unmount();
  const restored = renderHook(() => useBoardFileController({ repository: f.repository, board: { ...f.board, ...changed }, active: () => true, select: vi.fn(), setStatus: vi.fn() }));
  await waitFor(() => expect(restored.result.current.boardFile?.locationKind).toBe("managed"));
  restored.unmount();
});

test("imports a recovered managed Canvas title from explicit metadata and preserves user hash titles", async () => {
  const f = await fixture();
  const hook = renderHook(() => useBoardFileController({ repository: f.repository, active: () => true, select: vi.fn(), setStatus: vi.fn() }));
  const userTitle = "b".repeat(64);
  for (const [mountId, title, fileName] of [["managed", userTitle, `${"a".repeat(64)}.canvas`], ["vault", userTitle, `${userTitle}.canvas`]]) {
    let ref!: ReturnType<typeof refOf>;
    await act(async () => { ref = await hook.result.current.resolveBoardFile({ mountId, path: fileName, name: fileName, version: "v1", text: JSON.stringify({ nodes: [], liteasy: { title } }) }); });
    expect((await f.repository.get(ref)).title).toBe(userTitle);
  }
  hook.unmount();
});

test("a native file error exposes a readable recovery message and preserves technical detail separately", async () => {
  const f = await fixture();
  files.managedCanvas = vi.fn().mockRejectedValue(new Error("ENOENT /private/9b650e17-1f85-4be9-bf11-ec88d5dd16e4.canvas"));
  const status = vi.fn();
  const hook = renderHook(() => useBoardFileController({ repository: f.repository, board: f.board, active: () => true, select: vi.fn(), setStatus: status }));
  await waitFor(() => expect(hook.result.current.fileError).toBeDefined(), { timeout: 2500 });
  expect(status.mock.calls.at(-1)?.[0]).toContain("请检查文件是否仍可访问");
  expect(status.mock.calls.flat().join(" ")).not.toContain("9b650e17");
  expect(hook.result.current.fileError?.details).toContain("ENOENT /private/9b650e17");
  hook.unmount();
});
