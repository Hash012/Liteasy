import { beforeEach, expect, test } from "vitest";
import { contextPickerFixture } from "./contextPickerFixture";
import { createContextCatalogPort } from "../app/features/context-picker/catalogPort";
import { browserStateKey, defaultLocation, readBrowserState, routeKey, writePickerRecord } from "../app/features/context-picker/pickerState";
import { emptySelectionDraft, addSelectionIntent, selectionMembers } from "../app/features/context-picker/selectionPlan";
beforeEach(() => localStorage.clear());

test.each([[[], "all"], [["image"], "image"], [["image", "note"], "all"], [["paper"], "document"], [["invalid"], "all"]])("CAT-05: v2 kinds %j migrate to %s without losing the route", (kinds, activeKind) => {
  const key = browserStateKey("s", "w", "context"), route = ["collections", "a", "paper:p"];
  writePickerRecord(key, { schemaVersion: 2, route, history: [route], historyIndex: 0, entries: {}, locations: { [routeKey(route)]: { ...defaultLocation(), activeKind: undefined, kinds, previewId: "image-49", page: 2, query: "tag:keep" } } });
  const state = readBrowserState(key, "s");
  expect(state.schemaVersion).toBe(3); expect(state.route).toEqual(route);
  expect(state.locations[routeKey(route)]).toMatchObject({ activeKind, previewId: "image-49", page: 2, query: "tag:keep" });
  expect(state.locations[routeKey(route)]).not.toHaveProperty("kinds");
});
test("GROUP-01/02/04: root image bundles select all 760 frozen matches, never the paper or note", () => {
  const f = contextPickerFixture(760);
  const result = f.catalog.query(["types"], { activeKind: "image" });
  expect(result.total).toBe(1); expect(result.nodes[0]).toMatchObject({ title: "论文 P", count: 760 });
  const intent = f.catalog.plan(["types"], result.allNodes, "filtered");
  expect(intent.members).toHaveLength(760); expect(intent.members.every(member => member.representation === "image")).toBe(true);
  const filtered = f.catalog.query(["types"], { activeKind: "image", query: "tag:keep" });
  expect(filtered.nodes[0].count).toBe(76);
  expect(f.catalog.plan(["types"], filtered.allNodes, "filtered").members).toHaveLength(76);
  const unknown = createContextCatalogPort({ ...f.source, inventories: {} });
  const pending = unknown.query(["types"], { activeKind: "image" });
  expect(pending.nodes[0].count).toBeUndefined(); expect(() => unknown.plan(["types"], pending.allNodes, "filtered")).toThrow("尚未完整");
});
test("CAT-03: selected resources remain an intersection of category and search", () => {
  const f = contextPickerFixture();
  const result = f.catalog.query(["types", "paper:p"], { activeKind: "image", selectedIds: ["image-0", "note"], query: "tag:keep" });
  expect(result.allNodes.map(node => node.id)).toEqual(["image-0"]);
});
test("LOAD-01/02: cursors bind the complete query and append nonoverlapping batches", () => {
  const f = contextPickerFixture(150), first = f.catalog.query(f.imageRoute, { activeKind: "image", limit: 60 });
  const second = f.catalog.query(f.imageRoute, { activeKind: "image", limit: 60, cursor: first.cursor });
  expect(first.nodes).toHaveLength(60); expect(second.nodes).toHaveLength(60);
  expect(new Set([...first.nodes, ...second.nodes].map(node => node.id)).size).toBe(120);
  expect(() => f.catalog.query(f.imageRoute, { activeKind: "note", limit: 60, cursor: first.cursor })).toThrow("筛选已变化");
  const next = createContextCatalogPort({ ...f.source, revision: "r2" });
  expect(() => next.query(f.imageRoute, { activeKind: "image", cursor: first.cursor })).toThrow("目录或筛选已变化");
});
test("LOAD-03: physical page precedes source order and unknown page, independently of title", () => {
  const f = contextPickerFixture(3);
  const catalog = createContextCatalogPort({ ...f.source, relations: f.source.relations!.map(relation => ({ ...relation, page: relation.assetId === "image-0" ? 50 : relation.assetId === "image-1" ? 49 : undefined })) });
  expect(catalog.query(f.imageRoute).allNodes.map(node => node.id)).toEqual(["image-1", "image-0", "image-2"]);
});
test("GROUP-03: same-name identities stay separate; overlapping memberships dedupe fixed versions", () => {
  const f = contextPickerFixture(2);
  const catalog = createContextCatalogPort({ ...f.source, entries: f.source.entries.map(entry => ({ ...entry, title: "同名文献" })) });
  expect(catalog.query(["types"]).allNodes.filter(node => node.kind === "paper")).toHaveLength(2);
  const member = f.catalog.member(f.assets[3]);
  let draft = addSelectionIntent(emptySelectionDraft(), { id: "a", catalogRevision: "r1", policy: "items", members: [member], exclusions: [] });
  draft = addSelectionIntent(draft, { id: "b", catalogRevision: "r1", policy: "items", members: [{ ...member, id: "alias" }], exclusions: [] });
  expect(selectionMembers(draft)).toHaveLength(1);
  draft = addSelectionIntent(draft, { id: "c", catalogRevision: "r1", policy: "items", members: [{ ...member, id: "new-version", revision: "r2" }], exclusions: [] });
  expect(selectionMembers(draft)).toHaveLength(2);
});
test("GROUP-01: cross-paper products stay independent without an unambiguous owner", () => {
  const f = contextPickerFixture(2);
  const shared = { ...f.assets[2], id: "shared", category: "产物", searchMetadata: { kind: "artifact" } };
  const catalog = createContextCatalogPort({ ...f.source, assets: [...f.assets, shared], relations: [...f.source.relations!, { assetId: shared.id, paperIds: ["p", "q"] }] });
  expect(catalog.query(["types"]).allNodes.find(node => node.id === "shared")?.kind).toBe("asset");
});
