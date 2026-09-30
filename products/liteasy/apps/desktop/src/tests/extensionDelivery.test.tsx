import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { decodedMediaBytes, reserveVisualMedia, visualMediaUsage, readVisualMedia } from "../app/features/visual-blocks/mediaBudget";
import { AssetImage, VisualAssetContext } from "../app/features/visual-blocks/AssetImage";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
import { visibleBoardPlacements } from "../app/features/boards/useVisiblePlacements";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, type Placement } from "../app/features/objects/object.types";
import { createBlockRegistry, projectBlockText } from "../app/features/visual-blocks/blockRegistry";
import { parseCanvasFile, serializeCanvasFile } from "../app/features/boards/boardFileFormat";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
const png = (width: number, height: number) => { const bytes = new Uint8Array(33), view = new DataView(bytes.buffer); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12); view.setUint32(16, width); view.setUint32(20, height); return bytes; };
test("compressed image headers and concurrent reads respect the visible media budget", async () => {
  expect(decodedMediaBytes(png(32, 64), "image/png")).toBe(33 + 32 * 64 * 4);
  expect(() => decodedMediaBytes(png(50000, 50000), "image/png")).toThrow("体积");
  expect(() => decodedMediaBytes(new Uint8Array(2), "image/png")).toThrow();
  const release = reserveVisualMedia(20 * 1024 * 1024);
  expect(() => reserveVisualMedia(5 * 1024 * 1024)).toThrow("预算"); release(); release(); expect(visualMediaUsage()).toBe(0);
  const deferred: Array<() => void> = [], starts: number[] = [], abort = new AbortController();
  const tasks = [0, 1, 2].map((index) => readVisualMedia(() => new Promise<void>((resolve) => { starts.push(index); deferred.push(resolve); }), index === 2 ? abort.signal : new AbortController().signal));
  const cancelled = expect(tasks[2]).rejects.toBeDefined();
  expect(starts).toEqual([0, 1]); abort.abort(); deferred.forEach((resolve) => resolve());
  await Promise.all([tasks[0], tasks[1], cancelled]); expect(starts).toEqual([0, 1]);
});
test("twenty view lifecycles release actual image URLs and decoded reservations", async () => {
  Object.defineProperty(URL, "createObjectURL", { value: () => "", configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, configurable: true });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test"), revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const assets = { resolveImages: vi.fn(async () => [{ base64: btoa(String.fromCharCode(...png(16, 16))), mediaType: "image/png" }]) } as unknown as AgentAssetService;
  for (let index = 0; index < 20; index++) {
    const view = render(<VisualAssetContext.Provider value={assets}><AssetImage source="liteasy://objects/figure?scope=test" alt="本地证据" /></VisualAssetContext.Provider>);
    await waitFor(() => expect(screen.getByRole("img", { name: "本地证据" })).toHaveAttribute("src", "blob:test"));
    expect(visualMediaUsage()).toBeGreaterThan(0); view.unmount(); expect(visualMediaUsage()).toBe(0);
  }
  expect(create).toHaveBeenCalledTimes(20); expect(revoke).toHaveBeenCalledTimes(20);
});
test("one thousand canvas placements mount only viewport content with a hard visible bound", () => {
  const placements = Array.from({ length: 1000 }, (_, index) => ({ placementId: String(index), position: { x: index * 400, y: 0 }, size: { width: 320, height: 300 } } as Placement));
  const visible = visibleBoardPlacements(placements, { left: 0, top: 0, width: 900, height: 600 }, ["900"]);
  expect(visible.map((item) => item.placementId)).toEqual(["900", "0", "1", "2"]);
  expect(visibleBoardPlacements(placements, { left: 0, top: 0, width: 1e6, height: 600 }, [])).toHaveLength(80);
});
test("content updates, undo/redo and grouping preserve independent saved geometry", async () => {
  const scope = crypto.randomUUID(), repo = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  let board = await repo.create({ kind: "workspace.board", title: "比较", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  const data = createBlockRegistry().instantiate("liteasy/RichTextBlock", "1.0.0", { text: "$x^2$" });
  const block = { schema: "liteasy.visual-block/v1" as const, type: { id: "liteasy/RichTextBlock", version: "1.0.0" }, data };
  const note = await repo.createStructuredBlock({ title: "公式", text: projectBlockText(data), block, boardRef: refOf(board), operationId: "create" });
  board = await repo.resolveLatest(board.objectId); let [p] = await repo.listPlacements(board.objectId); const original = p.position;
  await repo.applyBoardPatch({ boardRef: refOf(board), operationId: "move", move: [{ placementId: p.placementId, revision: p.revision, position: { x: 700, y: 500 } }] });
  const updated = await repo.updateStructuredBlock({ ref: refOf(note), title: "新公式", text: "$y^2$", block: { ...block, data: { text: "$y^2$" } }, operationId: "update" });
  [p] = await repo.listPlacements(board.objectId); expect(p.position).toEqual({ x: 700, y: 500 }); expect(p.ref.revision).toBe(updated.revision);
  await repo.restoreBoardLayout(refOf(await repo.resolveLatest(board.objectId)), "undo", "undo");
  [p] = await repo.listPlacements(board.objectId); expect(p.position).toEqual(original); expect(p.ref.revision).toBe(updated.revision);
  await repo.restoreBoardLayout(refOf(await repo.resolveLatest(board.objectId)), "redo", "redo");
  expect((await repo.listPlacements(board.objectId))[0].position.x).toBe(700);
  await repo.groupPlacements(refOf(await repo.resolveLatest(board.objectId)), [p.placementId], "group");
  const document = parseCanvasFile(await serializeCanvasFile({ repository: repo, board: await repo.resolveLatest(board.objectId), placements: await repo.listPlacements(board.objectId), edges: [] }));
  expect(document.nodes.filter((node) => node.type === "group")).toHaveLength(1);
  await expect(repo.editNote(refOf(updated), "replace")).rejects.toThrow("结构化");
});
