import { describe, expect, it, vi } from "vitest";
import { queryContextCatalog } from "../app/features/assistant/contextCatalogQuery";
import { mergeContextSelection } from "../app/features/assistant/contextSelectionManifest";
import type { AssistantComposerSuggestion, AssistantContextToken } from "../app/features/assistant/assistant.types";
const asset = (id: string, projectId: string, kind: string, tags: string[] = []): AssistantComposerSuggestion => ({
  id, label: id, trigger: "@", projectId, projectTitle: projectId, category: kind === "image" ? "图片" : "笔记",
  searchMetadata: { kind, tags, origin: "unknown", format: kind === "image" ? "png" : "markdown" },
  token: { id, label: id, kind: "object", prompt: "" },
});
describe("context catalog query snapshot", () => {
  it("combines project and kind unions, shared syntax and relevant facet counts", () => {
    const items = [asset("a", "A", "image", ["one", "two"]), asset("b", "B", "note", ["one"]), asset("c", "C", "image", ["two"])];
    const result = queryContextCatalog(items, { query: "tag:one", projects: ["A", "B"], kinds: ["image", "note"] });
    expect(result.matches.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.projectCounts.get("C")).toBeUndefined();
    expect(result.kindCounts.get("image")).toBe(1);
    expect(result.groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(2);
    expect(queryContextCatalog(items, { query: "tag:one tag:two" }).matches.map((item) => item.id)).toEqual(["a"]);
    expect(queryContextCatalog(items, { query: "tag-any:one tag-any:two -tag:two" }).matches.map((item) => item.id)).toEqual(["b"]);
  });
  it("uses all matching leaves across pages without resolving or preparing any item", () => {
    const read = vi.fn();
    const items = Array.from({ length: 130 }, (_, i) => ({ ...asset(String(i), "A", "image"), resolveToken: read, loadPreview: read }));
    items.push({ ...asset("project", "A", "project"), category: "项目", resolveToken: read, loadPreview: read });
    const snapshot = queryContextCatalog(items, { query: "", groupBy: "project" });
    expect(snapshot.selectableIds).toHaveLength(130);
    expect(snapshot.groups[0].selectableIds).toHaveLength(130);
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps application resources addressable outside the default research domain", () => {
    const app = { ...asset("help", "", "help"), category: "帮助" };
    expect(queryContextCatalog([app], {}).matches).toEqual([]);
    expect(queryContextCatalog([app], { domain: "application" }).matches).toEqual([app]);
  });
  it("sorts deterministically and filters inclusive since and exclusive until", () => {
    const items = ["2026-10-13T00:00:00Z", "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z"].map((updatedAt, index) => ({ ...asset(String(index), "A", "note"), updatedAt }));
    expect(queryContextCatalog(items, { query: 'since:"2026-10-14T00:00:00Z" until:"2026-10-15T00:00:00Z"' }).matches.map((item) => item.id)).toEqual(["1"]);
    expect(queryContextCatalog(items, { sort: "updated" }).matches.map((item) => item.id)).toEqual(["2", "1", "0"]);
  });
});
describe("resolved context selection", () => {
  const token = (id: string, revision: string, selectorId?: string): AssistantContextToken => ({ id, label: "同名", kind: "object", prompt: "", contextRefs: [{ objectId: "object", revision, ...(selectorId ? { selectorId } : {}) }] });
  it("deduplicates aliases after resolution while retaining revisions and selectors", () => {
    const existing = [token("first", "r1")];
    expect(mergeContextSelection(existing, token("alias", "r1"))).toBeUndefined();
    expect(mergeContextSelection(existing, token("next", "r2"))).toEqual(token("next", "r2"));
    expect(mergeContextSelection(existing, token("fragment", "r1", "selection"))).toEqual(token("fragment", "r1", "selection"));
  });
});

it("counts kind facets with the query's own kind constraints removed", () => {
  const items = [asset("image", "A", "image"), asset("note", "A", "note"), asset("other", "B", "note")];
  const result = queryContextCatalog(items, { query: "kind:image", projects: ["A"] });
  expect(result.matches.map((item) => item.id)).toEqual(["image"]);
  expect(result.kindCounts.get("note")).toBe(1);
});

it("shows a canonical pinned asset once when its two project memberships both match", () => {
  const first = { ...asset("alias-a", "A", "image"), resourcePath: "liteasy://local/objects/source@r1" };
  const second = { ...asset("alias-b", "B", "image"), resourcePath: first.resourcePath };
  expect(queryContextCatalog([first, second], { projects: ["A", "B"] }).matches).toHaveLength(1);
  expect(queryContextCatalog([first, second], { projects: ["B"] }).matches).toEqual([second]);
});

it("counts tags, formats and origins with the corresponding dimension excluded", () => {
  const cases = [["a", "one", "png", "import"], ["b", "one", "jpg", "import"], ["c", "one", "png", "user"], ["d", "two", "png", "import"]];
  const items = cases.map(([id, tag, format, origin]) => ({ ...asset(id, "A", "image", [tag]), searchMetadata: { kind: "image", tags: [tag], format, origin } }));
  const result = queryContextCatalog(items, { query: "tag:one format:png origin:import" });
  expect(result.matches.map((item) => item.id)).toEqual(["a"]);
  expect(Object.fromEntries(result.facetCounts.tag)).toEqual({ one: 1, two: 1 });
  expect(Object.fromEntries(result.facetCounts.format)).toEqual({ png: 1, jpg: 1 });
  expect(Object.fromEntries(result.facetCounts.origin)).toEqual({ import: 1, user: 1 });
});
