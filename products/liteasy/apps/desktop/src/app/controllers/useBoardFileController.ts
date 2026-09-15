import { useEffect, useMemo, useRef, useState } from "react";
import { createNoteFileService } from "../features/note-files/noteFileService";
import type { ObjectRepository } from "../features/objects/objectRepository";
import {
  refOf,
  type ObjectEnvelope,
  type ObjectRef,
} from "../features/objects/object.types";
import {
  parseCanvasFile,
  prepareCanvasImport,
  serializeCanvasFile,
  type BoardFileBinding,
  type BoardFileSnapshot,
} from "../features/boards/boardFileFormat";

export function useBoardFileController(input: {
  repository: ObjectRepository;
  board?: ObjectEnvelope;
  active(): boolean;
  select(board: ObjectEnvelope): Promise<void>;
  setStatus(message: string): void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const service = useMemo(
    () =>
      createNoteFileService(
        input.repository.scopeId,
        () => latest.current.repository.scopeId,
      ),
    [input.repository],
  );
  const [binding, setBinding] = useState<BoardFileBinding>();
  const [fileBusy, setFileBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    queue.current = Promise.resolve();
    setFileBusy(false);
  }, [input.repository]);
  const report = (error: unknown) => {
    if (input.active())
      input.setStatus(
        error instanceof Error ? error.message : "白板文件保存失败。",
      );
  };
  useEffect(() => {
    let alive = true;
    setBinding(undefined);
    if (input.board)
      void input.repository
        .getBoardFileBinding<BoardFileBinding>(input.board.objectId)
        .then((value) => {
          if (alive) setBinding(value);
        })
        .catch(report);
    return () => {
      alive = false;
    };
  }, [input.repository, input.board?.objectId]);

  async function serializeBoardFile(
    ref: ObjectRef,
    target?: BoardFileSnapshot,
  ) {
    const board = await input.repository.get(ref);
    if (board.kind !== "workspace.board")
      throw new Error("请选择一个白板文件。");
    const head = await input.repository.resolveLatest(board.objectId);
    if (head.revision !== ref.revision)
      throw new Error("白板已变化，请重新选择后导出。");
    const current =
      await input.repository.getBoardFileBinding<BoardFileBinding>(
        board.objectId,
      );
    const [placements, edges] = await Promise.all([
      input.repository.listPlacements(board.objectId),
      input.repository.listEdges(board.objectId),
    ]);
    const text = await serializeCanvasFile({
      board,
      placements,
      edges,
      repository: input.repository,
      binding: current,
      destinationMountId: target?.mountId,
    });
    if (
      (await input.repository.resolveLatest(board.objectId)).revision !==
      ref.revision
    )
      throw new Error("白板在导出时发生变化，请重试。");
    return text;
  }
  async function resolveBoardFile(file: BoardFileSnapshot): Promise<ObjectRef> {
    const document = parseCanvasFile(file.text);
    // Reopening an unchanged file selects its existing board, including local
    // edits pending a failed save. External conflicts require explicit save-as.
    let cursor: string | undefined;
    let replaceRef: ObjectRef | undefined;
    do {
      const page = await input.repository.search("", cursor);
      for (const object of page.objects.filter(
        (item) => item.kind === "workspace.board",
      )) {
        const saved =
          await input.repository.getBoardFileBinding<BoardFileBinding>(
            object.objectId,
          );
        if (saved?.mountId !== file.mountId || saved.path !== file.path)
          continue;
        if (saved.version === file.version) return refOf(object);
        if (saved.savedRevision !== object.revision)
          throw new Error(
            "白板和外部文件都有修改。请先将当前白板另存为文件，再打开外部版本。",
          );
        replaceRef = refOf(object);
      }
      cursor = page.cursor;
    } while (cursor);
    const prepared = await prepareCanvasImport({
      document,
      repository: input.repository,
      file,
      readFile: (mountId, path) => service.readFile(mountId, path),
    });
    const board = await input.repository.importBoardFile({
      ...prepared,
      replaceRef,
      title: file.name.replace(/\.canvas$/i, ""),
      operationId: crypto.randomUUID(),
    });
    // Mark imported references in the preserved document so editing one in
    // Liteasy can become a text card without rewriting its source file.
    document.nodes = document.nodes.map((node) => ({
      ...node,
      liteasy: { ref: prepared.nodes.find((item) => item.id === node.id)?.ref },
    }));
    const next: BoardFileBinding = {
      mountId: file.mountId,
      path: file.path,
      name: file.name,
      version: file.version,
      savedRevision: board.revision,
      document,
    };
    await input.repository.setBoardFileBinding(board.objectId, next);
    if (!input.active()) throw new Error("账号已切换。");
    return refOf(board);
  }
  async function openBoardFile(file: BoardFileSnapshot) {
    const ref = await resolveBoardFile(file);
    const board = await input.repository.get(ref);
    if (!input.active()) return;
    await input.select(board);
    setBinding(
      await input.repository.getBoardFileBinding<BoardFileBinding>(
        board.objectId,
      ),
    );
    input.setStatus(`已打开 ${file.name}`);
  }
  async function chooseBoardFile() {
    setFileBusy(true);
    try {
      const file = await service.chooseFile({
        mode: "open",
        extension: "canvas",
      });
      if (file) await openBoardFile(file);
    } catch (error) {
      report(error);
    } finally {
      if (input.active()) setFileBusy(false);
    }
  }
  async function saveBoardFile(choose = false) {
    const object = latest.current.board;
    if (!object) throw new Error("请先创建白板。");
    setFileBusy(true);
    const operation = queue.current
      .catch(() => undefined)
      .then(async () => {
        const current =
          await input.repository.getBoardFileBinding<BoardFileBinding>(
            object.objectId,
          );
        const target =
          choose || !current
            ? await service.chooseFile({
                mode: "save",
                extension: "canvas",
                suggestedName: `${object.title.replace(/\.canvas$/i, "")}.canvas`,
              })
            : current;
        if (!target || !input.active()) return;
        const board = await input.repository.resolveLatest(object.objectId);
        const text = await serializeBoardFile(refOf(board), {
          ...target,
          text: "",
        });
        const saved = await service.writeFile({
          mountId: target.mountId,
          path: target.path,
          text,
          expectedVersion: target.version,
        });
        const next: BoardFileBinding = {
          mountId: saved.mountId,
          path: saved.path,
          name: saved.name,
          version: saved.version,
          savedRevision: board.revision,
          document: parseCanvasFile(text),
        };
        await input.repository.setBoardFileBinding(board.objectId, next);
        if (
          input.active() &&
          latest.current.board?.objectId === board.objectId
        ) {
          setBinding(next);
          input.setStatus(`已保存 ${saved.name}`);
        }
      });
    queue.current = operation;
    try {
      await operation;
    } finally {
      if (input.active()) setFileBusy(false);
    }
  }
  const saveRef = useRef(saveBoardFile);
  saveRef.current = saveBoardFile;
  useEffect(() => {
    if (!binding || binding.savedRevision === input.board?.revision) return;
    const timer = window.setTimeout(
      () => void saveRef.current().catch(report),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [input.repository, input.board?.objectId, input.board?.revision, binding]);
  return {
    boardFile: binding,
    fileBusy,
    openBoardFile,
    resolveBoardFile,
    chooseBoardFile,
    saveBoardFile,
    serializeBoardFile,
  };
}
