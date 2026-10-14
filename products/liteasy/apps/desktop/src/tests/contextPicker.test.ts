import { beforeEach, expect, test, vi } from "vitest";
import { contextPickerFixture } from "./contextPickerFixture";
import { createContextCatalogPort } from "../app/features/context-picker/catalogPort";
import { reconcileLegacyCollections } from "../app/features/context-picker/collectionRegistry";
import { addSelectionIntent, emptySelectionDraft, excludeSelectionMembers, selectionMembers, undoSelectionIntent, resolveSelectionBatch, subtractContextRanges } from "../app/features/context-picker/selectionPlan";
import { browserStateKey, draftStateKey, readBrowserState, writePickerRecord, defaultLocation, routeKey, navigatePicker, traversePickerHistory } from "../app/features/context-picker/pickerState";
import { clearPickerActivity, defaultRecommendationSettings, evaluateRecommendations, readPickerActivity, recommendContextAssets, recordPickerActivity, saveRecommendationSettings } from "../app/features/context-picker/recommendations";
import { referenceSourceStructure, structureSelection } from "../app/features/context-picker/sourceStructure";
import type { ReferenceDocument } from "../app/features/resource-links/resourceReferenceService";
beforeEach(() => localStorage.clear());

test("NAV-01/02/03: one canonical catalog reaches collections, originals, images and uncollected papers", () => {
  const f = contextPickerFixture();
  expect(f.catalog.query(["collections"]).allNodes.map(node => node.id)).toContain("uncollected");
  expect(f.catalog.query(["collections", "uncollected"]).allNodes.map(node => node.entry?.id)).toEqual(["q"]);
  expect(f.catalog.query(f.imageRoute).total).toBe(75);
  expect(f.catalog.query(f.imageRoute).nodes[0].asset).toBe(f.assets[3]);
  expect(f.catalog.breadcrumbs(f.imageRoute).map(crumb => crumb.title)).toEqual(["Collections", "A", "论文 P", "提取资产", "图片"]);
  expect(f.catalog.locate("image-0")).toContainEqual(f.imageRoute);
  expect(f.catalog.locate("image-0")).toContainEqual(["collections", "b", "paper:p", "extracted", "image"]);
});
test("STATE-04: collection rename retains identity and a deleted path falls back to its accessible ancestor", () => {
  const old = reconcileLegacyCollections("s", [{ id: "p", collection: "旧名字" }]);
  const renamed = reconcileLegacyCollections("s", [{ id: "p", collection: "新名字" }]);
  expect(renamed[0].id).toBe(old[0].id);
  const f = contextPickerFixture();
  expect(f.catalog.validRoute(["collections", "a", "paper:deleted", "original"])).toEqual(["collections", "a"]);
});
test("STATE-01/02/03: each location keeps its own query, page, preview, anchor and focus through history", () => {
  const key = browserStateKey("s", "w", "context");
  let state = readBrowserState(key, "s");
  const first = ["collections", "a"], second = [...first, "paper:p", "extracted", "image"];
  state = navigatePicker(state, first);
  state.locations[routeKey(first)] = { ...defaultLocation(), query: "论文", sort: "year" };
  state = navigatePicker(state, second);
  state.locations[routeKey(second)] = { ...defaultLocation(), query: "图", page: 2, view: "gallery", previewId: "image-121", focusId: "image-120", anchor: { id: "image-120", offset: 8 } };
  writePickerRecord(key, state);
  const restored = readBrowserState(key, "s");
  expect(restored).toEqual(state);
  const previous = traversePickerHistory(restored, -1);
  expect(previous.locations[routeKey(previous.route)].query).toBe("论文");
  expect(traversePickerHistory(previous, 1).route).toEqual(second);
  expect(draftStateKey("s", "w", "context", "A")).not.toBe(draftStateKey("s", "w", "context", "B"));
  expect(browserStateKey("other", "w", "context")).not.toBe(key);
  expect(browserStateKey("s", "w", "reference")).not.toBe(key);
});
test("STATE-05: corrupt or unavailable storage falls back without blocking the picker", () => {
  const key = browserStateKey("s", "w", "context"); localStorage.setItem(key, "{bad");
  expect(readBrowserState(key, "s").route).toEqual(["collections"]);
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
  expect(readBrowserState(key, "s").route).toEqual(["collections"]); get.mockRestore();
});
test("SCOPE-02: foreign assets never enter counts or plans", () => {
  const f = contextPickerFixture();
  const catalog = createContextCatalogPort({ ...f.source, assets: [...f.assets, { ...f.assets[3], id: "secret", label: "秘密", scopeId: "other" }] });
  expect(catalog.assetById.has("secret")).toBe(false);
  expect(catalog.query(["types"], { query: "秘密" }).total).toBe(0);
});
test("QUERY-01: year, author, reading status and source-page filtering use known metadata", () => {
  const f = contextPickerFixture();
  expect(f.catalog.query(["collections", "all-papers"], { sort: "year" }).allNodes.map(node => node.entry?.id)).toEqual(["q", "p"]);
  expect(f.catalog.query(["collections", "all-papers"], { filters: { year: "2024", readingStatus: "reading" } }).total).toBe(1);
  expect(f.catalog.query(f.imageRoute, { filters: { page: "4" } }).allNodes.map(node => node.id)).toEqual(["image-0"]);
  expect(f.catalog.query(f.imageRoute, { filters: { page: "unknown" } }).total).toBe(0);
});
test("BULK-01/02/03/06: plans include every page, honor exclusions and remain fixed after catalog growth", () => {
  const f = contextPickerFixture();
  const result = f.catalog.query(f.imageRoute);
  expect(result.nodes).toHaveLength(60);
  const intent = f.catalog.plan(f.imageRoute, result.allNodes, "filtered");
  let draft = addSelectionIntent(emptySelectionDraft(), intent);
  expect(selectionMembers(draft)).toHaveLength(75);
  draft = excludeSelectionMembers(draft, ["image-4"]);
  expect(selectionMembers(draft)).toHaveLength(74);
  expect(selectionMembers(draft).some(member => member.id === "image-4")).toBe(false);
  const grown = createContextCatalogPort({ ...f.source, assets: [...f.assets, { ...f.assets[3], id: "image-new" }] });
  expect(grown.assetById.has("image-new")).toBe(true);
  expect(selectionMembers(draft)).toHaveLength(74);
  const filtered = f.catalog.query(f.imageRoute, { query: "tag:keep" });
  expect(f.catalog.plan(f.imageRoute, filtered.allNodes, "filtered").members).toHaveLength(8);
});
test("BULK-05/07: whole originals exclude notes, overlaps dedupe and group undo keeps independent choices", () => {
  const f = contextPickerFixture(12), roots = f.catalog.children(["collections"]);
  const a = f.catalog.plan(["collections"], [roots.find(node => node.id === "a")!], "originals");
  expect(a.members.map(member => member.id)).toEqual(["p"]);
  const allA = f.catalog.plan(["collections"], [roots.find(node => node.id === "a")!], "related");
  const allB = f.catalog.plan(["collections"], [roots.find(node => node.id === "b")!], "related");
  let draft = addSelectionIntent(emptySelectionDraft(), { ...a, id: "independent", members: [f.catalog.member(f.assets[3])] });
  draft = addSelectionIntent(addSelectionIntent(draft, allA), allB);
  expect(selectionMembers(draft)).toHaveLength(14);
  draft = undoSelectionIntent(undoSelectionIntent(draft, allA.id), allB.id);
  expect(selectionMembers(draft).map(member => member.id)).toEqual(["image-0"]);
});
test("BULK-09: unknown inventories never claim known zero or allow full related expansion", () => {
  const f = contextPickerFixture(), catalog = createContextCatalogPort({ ...f.source, inventories: {} });
  const categories = catalog.children(["collections", "a", "paper:p"]);
  expect(categories[1]).toMatchObject({ countState: "unknown", count: undefined });
  expect(() => catalog.plan(["collections", "a", "paper:p"], categories, "related")).toThrow("尚未完整");
});
test("ADD-05/BULK-08: batch acknowledgments dedupe aliases, retain versions and only retry failed items", async () => {
  const commit = vi.fn(async () => true), receipts: any[] = [];
  const members = ["first", "alias", "r2", "fail"].map(id => ({ id }));
  const resolve = vi.fn(async (member: { id: string }) => { if (member.id === "fail") throw new Error("offline"); return { id: member.id, label: member.id, kind: "object" as const, prompt: "", contextRefs: [{ objectId: "canonical", revision: member.id === "r2" ? "r2" : "r1" }] }; });
  await resolveSelectionBatch({ members, existing: [], signal: new AbortController().signal, active: () => true, resolve, commit, onReceipt: receipt => receipts.push(receipt) });
  expect(receipts.map(receipt => receipt.status)).toEqual(["added", "alreadyPresent", "added", "failed"]);
  expect(commit.mock.calls).toHaveLength(2);
});
test("SCOPE-01: closing during a read prevents the old result from committing", async () => {
  const abort = new AbortController(), commit = vi.fn();
  await expect(resolveSelectionBatch({ members: [{ id: "p" }], existing: [], signal: abort.signal, active: () => true,
    resolve: async () => { abort.abort(); return { id: "p", label: "p", kind: "object", prompt: "" }; }, commit, onReceipt: vi.fn() })).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled();
});
test("BULK-04: verified text complements exclude only the same source version and representation", () => {
  const whole = { source: "p", revision: "r1", representation: "text" as const, start: 0, end: 100 };
  expect(subtractContextRanges(whole, [{ ...whole, start: 20, end: 40 }, { ...whole, revision: "r2", start: 60, end: 80 }, { ...whole, representation: "image", start: 0, end: 100 }])).toEqual([{ ...whole, end: 20 }, { ...whole, start: 40 }]);
});
test("PARA-01/02: parsed Markdown uses stable source ranges; unmapped PDFs and truncated tails are not invented paragraphs", () => {
  const text = "# Title\n\nFirst paragraph.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$$x^2$$\n\nTail";
  const document: ReferenceDocument = { asset: { path: "source", title: "Source", kind: "content.note", revision: "r1", capabilities: [] }, text, complete: true, totalCharacters: text.length, limit: 80000 };
  const items = referenceSourceStructure(document);
  expect(items.some(item => item.type === "table")).toBe(true);
  expect(items.find(item => item.title === "First paragraph.")).toBeDefined();
  const item = items.find(item => item.title === "First paragraph.")!;
  expect(structureSelection(document, item).text).toBe("First paragraph.");
  expect(() => structureSelection({ ...document, asset: { ...document.asset, revision: "r2" } }, item)).toThrow("版本");
  expect(referenceSourceStructure({ ...document, complete: false }).some(item => item.title === "Tail")).toBe(false);
  expect(referenceSourceStructure({ ...document, asset: { ...document.asset, kind: "paper" } })).toEqual([]);
});
test("REC-01/03/04/05/06: recommendations are local, explainable, time-bounded and privacy-scoped", () => {
  const f = contextPickerFixture(3), now = Date.now();
  recordPickerActivity(f.source.scope, { id: "image-1", at: now, kind: "viewed", origin: "picker_preview" });
  expect(readPickerActivity(f.source.scope)).toEqual([]);
  recordPickerActivity(f.source.scope, { id: "image-2", at: now, kind: "viewed", origin: "reader" });
  expect(readPickerActivity("other")).toEqual([]);
  const catalog = createContextCatalogPort({ ...f.source, relations: f.source.relations!.map(relation => ({ ...relation, createdAt: new Date(relation.assetId === "image-0" ? now + 1000 : now - 1000).toISOString() })) });
  const ranked = recommendContextAssets(catalog, { now, activePaperId: "p" }, readPickerActivity(f.source.scope), defaultRecommendationSettings);
  expect(ranked.some(value => value.id === "image-0")).toBe(false);
  expect(ranked.every(value => value.reason.length > 0)).toBe(true);
  saveRecommendationSettings(f.source.scope, { ...defaultRecommendationSettings, recentReading: false });
  clearPickerActivity(f.source.scope);
  recordPickerActivity(f.source.scope, { id: "image-1", at: now, kind: "viewed", origin: "reader" });
  expect(readPickerActivity(f.source.scope)).toEqual([]);
  expect(evaluateRecommendations([{ expected: ["p"], ranked: ["p"], recentBaseline: ["q", "p"] }])).toMatchObject({ ranked: { hitRate: 1, mrr: 1 }, recentBaseline: { mrr: .5 } });
});
