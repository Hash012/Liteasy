import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, objectText } from "../app/features/objects/object.types";
import { blockPresentationSchema, defaultBlockPresentation } from "../app/features/objects/visualBlock.types";
import { parseCanvasFile, prepareCanvasImport, serializeCanvasFile } from "../app/features/boards/boardFileFormat";
import { RichTextBlock, VisualBlockBase } from "../app/features/visual-blocks/VisualBlockBase";
import { relativeImagePath } from "../app/features/visual-blocks/GrantedImage";
import { useBlockPresentation } from "../app/features/visual-blocks/useBlockPresentation";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
async function fixture() {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope);
  let board = await repository.create({ kind: "workspace.board", title: "比较板", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  const note = await repository.create({ kind: "content.note", title: "推理卡", content: { schema: "liteasy.note/v1", payload: { text: "$a^2+b^2=c^2$", origin: "user" } } });
  await repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(note)] });
  board = await repository.resolveLatest(board.objectId);
  const [placement] = await repository.listPlacements(board.objectId);
  return { scope, repository, board, note, placement };
}

test("typography persists separately from content and Canvas round trips retain it", async () => {
  const f = await fixture();
  const style = { ...defaultBlockPresentation, fontSize: 24, lineHeight: 1.8, locked: true };
  const request = { boardRef: refOf(f.board), placementId: f.placement.placementId, value: style, expectedVersion: null, operationId: "appearance" };
  await f.repository.setBlockPresentation(request);
  await f.repository.setBlockPresentation(request); // durable idempotency
  const reopened = createObjectRepository(createObjectStorage(f.scope, () => f.scope), f.scope);
  expect((await reopened.getBlockPresentation(f.board.objectId, f.placement.placementId)).value).toEqual(style);
  expect((await reopened.resolveLatest(f.note.objectId)).revision).toBe(f.note.revision);
  const board = await reopened.resolveLatest(f.board.objectId);
  await expect(reopened.applyBoardPatch({ boardRef: refOf(board), operationId: "move-locked", move: [{ placementId: f.placement.placementId, revision: f.placement.revision, position: { x: 400, y: 200 } }] })).rejects.toThrow("锁定");
  const document = parseCanvasFile(await serializeCanvasFile({ board, repository: reopened, placements: await reopened.listPlacements(board.objectId), edges: [] }));
  const prepared = await prepareCanvasImport({ document, repository: reopened, file: { mountId: "vault", path: "比较.canvas", name: "比较.canvas", version: null, text: JSON.stringify(document) }, readFile: vi.fn() });
  const imported = await reopened.importBoardFile({ ...prepared, title: "重新导入", operationId: "import" });
  expect((await reopened.getBlockPresentation(imported.objectId, f.placement.placementId)).value).toEqual(style);
  expect(objectText(await reopened.get((await reopened.listPlacements(imported.objectId))[0].ref))).toContain("$a^2+b^2=c^2$");
});

test("stale presentation cannot overwrite newer edits or silently replace unknown formats", async () => {
  const f = await fixture();
  await f.repository.setBlockPresentation({ boardRef: refOf(f.board), value: { ...defaultBlockPresentation, fontSize: 20 }, expectedVersion: null, operationId: "first" });
  const board = await f.repository.resolveLatest(f.board.objectId);
  await expect(f.repository.setBlockPresentation({ boardRef: refOf(board), value: defaultBlockPresentation, expectedVersion: null, operationId: "stale" })).rejects.toThrow("已变化");
  expect(blockPresentationSchema.safeParse({ schema: "liteasy.block-presentation/v2", fontSize: 20 }).success).toBe(false);
});

test("inherited rich content renders formulas, tables and images with adjustable typography", () => {
  const { container } = render(<VisualBlockBase identity="paper:1" fallback="源文" presentation={{ ...defaultBlockPresentation, fontSize: 24, lineHeight: 1.8 }}><RichTextBlock text={"# 推理\n\n$x^2$\n\n| 条件 | 结论 |\n| --- | --- |\n| A | B |\n\n![证据](https://example.test/figure.png)"} /></VisualBlockBase>);
  expect(screen.getByRole("heading", { name: "推理" })).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "证据" })).toHaveAttribute("src", "https://example.test/figure.png");
  expect(container.querySelector(".katex")).not.toBeNull();
  expect(container.querySelector(".visual-block-base")).toHaveStyle({ fontSize: "24px", lineHeight: "1.8" });
});

test("relative images stay in the selected directory", () => {
  expect(relativeImagePath("papers/chapter/note.md", "../images/figure%201.png")).toBe("papers/images/figure 1.png");
  expect(() => relativeImagePath("note.md", "../secret.png")).toThrow();
  expect(() => relativeImagePath("note.md", "file:///etc/private.png")).toThrow();
});

test("layout writes do not reload every card's typography, while inherited appearance changes do", async () => {
  const f = await fixture();
  const read = vi.spyOn(f.repository, "getBlockPresentation");
  const hook = renderHook(() => useBlockPresentation(f.repository, f.board.objectId, f.placement.placementId));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => {
    await f.repository.applyBoardPatch({ boardRef: refOf(f.board), operationId: "move", move: [{ placementId: f.placement.placementId, revision: f.placement.revision, position: { x: 300, y: 200 } }] });
  });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => {
    const board = await f.repository.resolveLatest(f.board.objectId);
    await f.repository.setBlockPresentation({ boardRef: refOf(board), expectedVersion: null, value: { ...defaultBlockPresentation, fontSize: 26 }, operationId: "font" });
  });
  await waitFor(() => expect(hook.result.current.value.fontSize).toBe(26));
  expect(read).toHaveBeenCalledTimes(4);
  hook.unmount();
});
