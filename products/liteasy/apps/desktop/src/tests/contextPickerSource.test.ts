import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { contextPickerSourceFixture } from "./contextPickerSourceFixture";
import { resolveReferencePdf } from "../app/features/resource-links/referencePdfSource";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
test("registered source page survives catalog and PDF resolution without a hand-written fragment", async () => {
  const f = await contextPickerSourceFixture();
  const asset = f.catalog.assets.find(asset => asset.id === "page-49")!;
  const result = await resolveReferencePdf({ path: asset.resourcePath!, repository: f.repository, papers: [f.paper] });
  expect(result?.page).toBe(49);
});

test("PAGE-03/04/06: explicit selectors override recorded pages but never bypass version checks", async () => {
  const f = await contextPickerSourceFixture(), path = f.suggestions.find(asset => asset.id === "page-49")!.resourcePath!;
  expect((await resolveReferencePdf({ path: `${path}#page=50`, repository: f.repository, papers: [f.paper] }))?.page).toBe(50);
  for (const selector of ["page=0", "page=NaN", "page=-2"]) await expect(resolveReferencePdf({ path: `${path}#${selector}`, repository: f.repository, papers: [f.paper] })).rejects.toThrow("页码无效");
  await expect(resolveReferencePdf({ path, repository: f.repository, papers: [{ ...f.paper, contentHash: "replaced" }] })).rejects.toThrow("已更换");
  await expect(resolveReferencePdf({ path, repository: f.repository, papers: [] })).rejects.toThrow("不在当前文献库");
});
test("PAGE-04/REGRESSION-01: missing anchors are explicit; derived notes still preview themselves", async () => {
  const f = await contextPickerSourceFixture();
  const asset = await f.projects.registerSource(f.project.projectId, { paperId: f.paper.id, assetId: "missing-page", kind: "text", title: "题名写第 49 页也不能猜", text: "excerpt", documentHash: f.paper.contentHash });
  const { liteasyPath } = await import("../app/features/resource-filesystem/liteasyPath");
  const path = liteasyPath(f.scope, { kind: "object", ref: asset.ref! });
  await expect(resolveReferencePdf({ path, repository: f.repository, papers: [f.paper] })).rejects.toThrow("未记录页码");
  const note = await f.projects.createEditableCopy(f.project.projectId, f.assets[1].ref!);
  const notePath = liteasyPath(f.scope, { kind: "object", ref: note.ref! });
  expect(await resolveReferencePdf({ path: notePath, repository: f.repository, papers: [f.paper] })).toBeUndefined();
  expect((await resolveReferencePdf({ path: liteasyPath(f.scope, { kind: "paper", paperId: f.paper.id }), repository: f.repository, papers: [f.paper] }))?.page).toBe(1);
});

test("PAGE-04/05: conflicting anchors fail explicitly and versioned regions survive resolution", async () => {
  const f = await contextPickerSourceFixture();
  const { liteasyPath } = await import("../app/features/resource-filesystem/liteasyPath");
  const { refOf } = await import("../app/features/objects/object.types");
  const source = f.objects.find(object => object.title.includes("49"))!;
  if (source.kind !== "source.document") throw new Error("fixture source kind");
  const anchors = source.paperAnchors!;
  const conflicting = await f.repository.create({ kind: "source.document", title: "冲突页码", paperAnchors: [anchors[0], { ...anchors[0], id: "other", locator: { ...anchors[0].locator, page: 50 } }], content: source.content });
  await expect(resolveReferencePdf({ path: liteasyPath(f.scope, { kind: "object", ref: refOf(conflicting) }), repository: f.repository, papers: [f.paper] })).rejects.toThrow("多个页码");
  const fragment = await f.repository.create({ kind: "content.fragment", title: "图的来源", sourceRefs: [refOf(source)], content: { schema: "liteasy.fragment/v1", payload: { text: "figure region", partial: true, anchors: [{ type: "pdf", sourceRef: refOf(source), documentHash: f.paper.contentHash, page: 49, quote: { exact: "", prefix: "", suffix: "" }, rects: [{ x: .2, y: .3, width: .4, height: .1 }], extractor: "pdf", normalization: "lf-utf16", precision: "exact" }] } } });
  const resolved = await resolveReferencePdf({ path: liteasyPath(f.scope, { kind: "object", ref: refOf(fragment) }), repository: f.repository, papers: [f.paper] });
  expect(resolved?.target).toMatchObject({ page: 49, precision: "region", region: { coordinateSpace: "normalized-viewport", rects: [{ x: .2, y: .3, width: .4, height: .1 }] } });
});

test("PAGE-04: legacy members supply only their exact versioned paper location", async () => {
  const f = await contextPickerSourceFixture();
  const { liteasyPath } = await import("../app/features/resource-filesystem/liteasyPath");
  const asset = await f.projects.registerSource(f.project.projectId, { paperId: f.paper.id, assetId: "legacy-member", kind: "text", title: "旧资产", text: "excerpt", documentHash: f.paper.contentHash });
  const path = liteasyPath(f.scope, { kind: "object", ref: asset.ref! });
  const member = { scopeId: f.scope, resourcePath: path, paperId: f.paper.id, page: 49 };
  const resolve = (value = member) => resolveReferencePdf({ path, repository: f.repository, papers: [f.paper], member: value });
  expect((await resolve())?.page).toBe(49);
  await expect(resolve({ ...member, paperId: "other-paper" })).rejects.toThrow("不一致");
  await expect(resolve({ ...member, resourcePath: `${path}-other-version` })).rejects.toThrow("不一致");
  await expect(resolve({ ...member, scopeId: "other-account" })).rejects.toThrow("不一致");
  await expect(resolveReferencePdf({ path, repository: f.repository, papers: [{ ...f.paper, contentHash: "replaced" }], member })).rejects.toThrow("已更换");
  const recordedPath = f.suggestions.find(item => item.id === "page-50")!.resourcePath!;
  expect((await resolveReferencePdf({ path: recordedPath, repository: f.repository, papers: [f.paper], member: { ...member, resourcePath: recordedPath, page: 49 } }))?.page).toBe(50);
});
