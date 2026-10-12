import "fake-indexeddb/auto";
import { createCanvas } from "@napi-rs/canvas";
import { afterEach, expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf } from "../app/features/objects/object.types";
import { compileBoardDocument } from "../app/features/document-export/boardExportAdapter";
import { renderDocumentHtml } from "../app/features/document-export/documentHtml";
const canvases = new WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvas>>();
function realOverviewCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function(this: HTMLCanvasElement) { const canvas = createCanvas(this.width, this.height); canvases.set(this, canvas); return canvas.getContext("2d") as any; });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function(this: HTMLCanvasElement) { return canvases.get(this)!.toDataURL("image/png"); });
}
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const scope = crypto.randomUUID(); let active = true;
  const storage = createObjectStorage(scope, () => active ? scope : "other");
  const repository = createObjectRepository(storage, scope);
  const card = await repository.create({ kind: "content.note", title: "完整卡片", content: { schema: "liteasy.note/v1", payload: { text: `完整卡片正文 ${"内容。".repeat(5000)} CARD_LAST_PARAGRAPH`, origin: "user" } } });
  const board = await repository.create({ kind: "workspace.board", title: "研究白板", content: { schema: "liteasy.board/v1", payload: { description: "说明" } } });
  await repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: [refOf(card), refOf(card)] });
  return { storage, repository, card, original: board, board: await repository.resolveLatest(board.objectId), switchAccount: () => { active = false; } };
}
test("real board snapshot exports full hidden model text once, all placements, overview and actual assets", async () => {
  realOverviewCanvas();
  const { repository, board } = await fixture();
  const document = await compileBoardDocument(board, repository), html = renderDocumentHtml(document);
  expect(html.match(/CARD_LAST_PARAGRAPH/g)).toHaveLength(1);
  expect(html).toContain("正文同卡片"); expect(html).toContain("全局总览");
  expect(document.assets).toHaveLength(1); expect(document.assets[0].mediaType).toBe("image/png");
  expect(document.sources.every(source => source.revision && source.state === "pinned")).toBe(true);
});
test("rejects historical layout and missing selected placements rather than substituting latest", async () => {
  realOverviewCanvas();
  const { repository, original, board } = await fixture();
  await expect(compileBoardDocument(original, repository)).rejects.toThrow("历史白板布局");
  await expect(compileBoardDocument(board, repository, { options: { scope: "selected_nodes", nodeIds: ["missing"] } })).rejects.toThrow("所选白板");
});
test("scope changes abort snapshot reads and publication authorization", async () => {
  realOverviewCanvas();
  const f = await fixture(), document = await compileBoardDocument(f.board, f.repository);
  f.switchAccount();
  await expect(document.assertAuthorized!()).rejects.toThrow("账号已切换");
  await expect(compileBoardDocument(f.board, f.repository)).rejects.toThrow("账号已切换");
});
test("snapshot is a readonly operation and refuses an over-budget result", async () => {
  const f = await fixture();
  const before = await f.storage.get(`head/${f.board.objectId}`);
  await f.repository.captureBoardExportSnapshot(refOf(f.board));
  expect(await f.storage.get(`head/${f.board.objectId}`)).toEqual(before);
  await expect(f.storage.snapshot!(["asset/"])).rejects.toThrow();
});
