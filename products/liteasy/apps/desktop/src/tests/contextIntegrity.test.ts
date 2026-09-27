import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createObjectRepository, type ObjectDraft } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf } from "../app/features/objects/object.types";
import { contextSnapshotImages, contextSnapshotPrompt, resolveContextSnapshot } from "../app/features/context/objectContext";
import { selectContextText } from "../app/features/context/contextSelection";
import { contextAttachments } from "../app/features/resource-filesystem/resourceContext";
import { stageImage } from "../app/features/objects/objectAssets";
import { paperAnchorFromEvidence, paperAnchorEntitySchema } from "../app/features/paper-anchors/paperAnchorEntity";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

const note = (title: string, text: string): ObjectDraft => ({ kind: "content.note", title,
  content: { schema: "liteasy.note/v1", payload: { text, origin: "user" } } });
function fixture() {
  const scopeId = crypto.randomUUID();
  let active = true;
  return { repository: createObjectRepository(createObjectStorage(scopeId, () => active ? scopeId : "other"), scopeId),
    active: () => active, switchAccount: () => { active = false; } };
}

test("balances long assets, selects relevant later passages, and reports the unread ranges", async () => {
  const { repository } = fixture();
  const long = await repository.create(note("长论文", `${"background ".repeat(6000)}\n\nCatalyst limitation: irreversible degradation.\n${"appendix ".repeat(2000)}`));
  const short = await repository.create(note("短笔记", "Compare the catalyst lifetime with the original experiment."));
  const snapshot = await resolveContextSnapshot({ repository, refs: [refOf(long), refOf(short)],
    purpose: "比较", question: "What is the catalyst limitation?", policy: "balanced", budget: 800 });
  expect(snapshot.tokens).toBeLessThanOrEqual(800);
  expect(snapshot.entries[0].text).toContain("Catalyst limitation");
  expect(snapshot.entries[1].text).toBe("Compare the catalyst lifetime with the original experiment.");
  expect(snapshot.entries[0].coverage).toMatchObject({ status: "partial", strategy: "question" });
  expect(snapshot.entries[0].coverage!.omittedRanges.length).toBeGreaterThan(0);
  expect(contextSnapshotPrompt(snapshot, "比较")).toContain("这不是全文");
  expect(snapshot.entries[0].sourceSha256).not.toBe(snapshot.entries[0].sha256);
});

test("checks every selected reference even if the text budget cannot include it", async () => {
  const { repository } = fixture();
  const valid = await repository.create(note("已有内容", "a".repeat(20_000)));
  await expect(resolveContextSnapshot({ repository, refs: [refOf(valid), { objectId: "missing", revision: "missing" }],
    purpose: "验证", policy: "balanced", budget: 0 })).rejects.toMatchObject({ code: "object_not_found" });
});

test("partial page reads retain a clickable source with a new excerpt identity and never expose the unread full quote", async () => {
  const { repository } = fixture();
  const text = "论文实验条件与研究结论。".repeat(2500);
  const anchor = paperAnchorFromEvidence({ id: "evidence-full-page", paperId: "paper", paperTitle: "论文", page: 3,
    pageTextStart: 0, pageTextEnd: text.length, quote: text });
  const page = await repository.create({ kind: "source.document", title: "论文 · 第 3 页", paperAnchors: [anchor],
    content: { schema: "liteasy.source-document/v1", payload: { paperId: "paper", pages: [{ page: 3, text }],
      text, availability: "local", legacyKey: "page3" } } });
  const snapshot = await resolveContextSnapshot({ repository, refs: [refOf(page)], purpose: "问题", policy: "balanced", budget: 80 });
  expect(snapshot.entries[0].coverage?.status).toBe("partial");
  const excerpt = snapshot.entries[0].paperAnchors?.[0];
  expect(excerpt).toBeDefined();
  expect(paperAnchorEntitySchema.safeParse(excerpt).success).toBe(true);
  expect(excerpt!.locator.page).toBe(3);
  expect(excerpt!.id).not.toBe(anchor.id);
  expect(snapshot.entries[0].text).toContain(excerpt!.snapshot.quote);
  expect(excerpt!.snapshot.quote.length).toBeLessThan(text.length);
  expect(JSON.stringify(snapshot)).not.toContain(text);
  expect(snapshot.tokens).toBeLessThanOrEqual(80);
});

test("checks account activity after asynchronous reads", async () => {
  const f = fixture();
  const object = await f.repository.create(note("scope", "content"));
  const get = f.repository.get;
  vi.spyOn(f.repository, "get").mockImplementation(async (ref) => {
    const result = await get(ref);
    f.switchAccount();
    return result;
  });
  await expect(resolveContextSnapshot({ repository: f.repository, refs: [refOf(object)], purpose: "read", policy: "balanced", active: f.active }))
    .rejects.toThrow("账号已切换");
});

test("keeps Unicode whole and identifies completely omitted resources", () => {
  const selected = selectContextText("😀中文".repeat(1000), 20);
  expect(selected.text).not.toMatch(/[\uD800-\uDBFF]$/);
  expect(selected.coverage.includedCharacters).toBeGreaterThan(0);
  expect(selectContextText("未读取", 0).coverage).toMatchObject({ status: "omitted", omittedRanges: [{ start: 0, end: 3 }] });
  expect(selectContextText(`${"背景".repeat(500)}催化剂失效原因是温度过高。${"附录".repeat(300)}`, 40, "催化剂失效原因").text).toContain("催化剂失效原因");
});

test("fixes board layout and connections when attached and never reads a newer board on send", async () => {
  const f = fixture();
  const board = await f.repository.importBoardFile({ title: "关系图", operationId: "initial",
    nodes: [
      { id: "a", draft: note("A", "原假设"), position: { x: 12, y: 34 }, size: { width: 100, height: 80 } },
      { id: "b", draft: note("B", "结果"), position: { x: 240, y: 50 }, size: { width: 100, height: 80 } },
    ], edges: [{ edgeId: "edge", from: "a", to: "b", kind: "related_to", label: "待验证关系" }] });
  const attachments = await contextAttachments(f.repository, [refOf(board)], f.active);
  await f.repository.importBoardFile({ title: "新布局", operationId: "updated", replaceRef: refOf(board), nodes: [], edges: [] });
  const readEdges = vi.spyOn(f.repository, "listEdges");
  const readPlacements = vi.spyOn(f.repository, "listPlacements");
  const snapshot = await resolveContextSnapshot({ repository: f.repository, refs: attachments[0].refs, purpose: "查看结构" });
  const body = snapshot.entries.map((entry) => entry.text).join("\n");
  expect(body).toContain("待验证关系");
  expect(body).toContain('"x": 12');
  expect(body).toContain("原假设");
  expect(readEdges).not.toHaveBeenCalled();
  expect(readPlacements).not.toHaveBeenCalled();
});

test("loads actual selected image bytes only for model input and keeps binary out of saved snapshots", async () => {
  const f = fixture();
  const asset = await stageImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), "image/png");
  const object = await f.repository.createImage(asset, "实验图");
  const snapshot = await resolveContextSnapshot({ repository: f.repository, refs: [refOf(object)], purpose: "看图", active: f.active });
  expect(JSON.stringify(await f.repository.getSnapshot(snapshot.snapshotId))).not.toContain(asset.base64);
  expect(await contextSnapshotImages(snapshot)).toEqual([{ mediaType: "image/png", base64: asset.base64, label: "资料图片：实验图" }]);
  const longTitle = await f.repository.createImage(asset, "图".repeat(1000));
  const longSnapshot = await resolveContextSnapshot({ repository: f.repository, refs: [refOf(longTitle)], purpose: "看图" });
  expect((await contextSnapshotImages(longSnapshot))[0].label.length).toBe(1000);
  await expect(contextSnapshotImages(structuredClone(snapshot))).rejects.toThrow("重新加入");
  f.switchAccount();
  await expect(contextSnapshotImages(snapshot)).rejects.toThrow("账号已切换");
});

test("refuses image groups beyond the declared budget instead of dropping images", async () => {
  const f = fixture();
  const refs = [];
  for (let index = 0; index < 13; index += 1) {
    const asset = await stageImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, index]), "image/png");
    refs.push(refOf(await f.repository.createImage(asset, `图 ${index}`)));
  }
  await expect(resolveContextSnapshot({ repository: f.repository, refs, purpose: "看图", policy: "balanced" })).rejects.toThrow("最多读取 12 张");
});
