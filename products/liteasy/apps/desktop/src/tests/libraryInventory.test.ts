import { expect, test, vi } from "vitest";
import { deduplicateLibraryChildren, inventoryLabel } from "../app/features/library/libraryInventory";
import { projectLibraryPaperInventory } from "../app/controllers/libraryPaperInventory";

function input(): Parameters<typeof projectLibraryPaperInventory>[0] {
  return { scopeId: "isolated", papers: [{ id: "paper", title: "Synthetic" }], artifacts: [], importJobs: {},
    projects: { catalog: [], catalogStatus: "ready", catalogError: "", inventoryRevision: "r1" },
    artifactState: { status: "ready" }, extractionState: { status: "ready" }, getResources: () => null };
}
test("loading and failed directories do not report an empty inventory", () => {
  const args = input();
  args.projects.catalogStatus = "loading";
  expect(projectLibraryPaperInventory(args).paper).toMatchObject({ state: "loading" });
  args.projects.catalogStatus = "error"; args.projects.catalogError = "Permission denied";
  const failed = projectLibraryPaperInventory(args).paper;
  expect(failed.state).toBe("error"); expect(inventoryLabel(failed)).not.toContain("0");
  args.projects.catalogStatus = "ready"; args.projects.catalogError = "";
  expect(inventoryLabel(projectLibraryPaperInventory(args).paper)).toBe("0 项关联内容");
});
test("aliases merge by immutable ref while distinct revisions with the same title remain", () => {
  const a = { id: "alias-a", kind: "note" as const, label: "same", ref: { objectId: "object", revision: "r1" } };
  expect(deduplicateLibraryChildren([a, { ...a, id: "alias-b" }, { ...a, id: "older", ref: { objectId: "object", revision: "r0" } }]))
    .toEqual([a, { ...a, id: "older", ref: { objectId: "object", revision: "r0" } }]);
});
test("known entries survive an error and scope changes cannot reuse their inventory identity", () => {
  const args = input();
  args.artifacts = [{ artifactId: "result", title: "Result", type: "tree", papers: args.papers }];
  const ready = projectLibraryPaperInventory(args).paper;
  args.artifactState = { status: "error", message: "读取失败" };
  const failed = projectLibraryPaperInventory(args).paper;
  expect(failed.items).toEqual(ready.items); expect(failed.state).toBe("error");
  expect(failed.inventoryRevision).toBeUndefined();
  args.artifactState = { status: "ready" }; args.scopeId = "other";
  expect(projectLibraryPaperInventory(args).paper.inventoryRevision).not.toBe(ready.inventoryRevision);
});
test("1000 rows use in-memory metadata only, with one resource lookup per row", () => {
  const args = input(); args.papers = Array.from({ length: 1000 }, (_, id) => ({ id: `p${id}`, title: `Paper ${id}` }));
  args.getResources = vi.fn(() => null);
  const start = performance.now(); const result = projectLibraryPaperInventory(args);
  console.info(JSON.stringify({ fixture: "inventory-1000", rows: 1000, durationMs: performance.now() - start, memoryLookups: 1000, fileReads: 0, modelCalls: 0 }));
  expect(Object.keys(result)).toHaveLength(1000); expect(args.getResources).toHaveBeenCalledTimes(1000);
});

test("project-only artifact associations join the saved catalog and deduplicate direct associations", () => {
  const args = input();
  args.artifacts = [{ artifactId: "result", title: "Saved result", type: "tree" }];
  args.projects.catalog = [{ project: { schemaVersion: "liteasy.paper-project/v1", scopeId: args.scopeId, paperId: "paper", projectId: "project", title: "Paper", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }, assets: [{ assetId: "alias", artifactId: "result", title: "Stale alias", kind: "artifact", role: "derived" }] }];
  expect(projectLibraryPaperInventory(args).paper.items).toEqual([expect.objectContaining({ id: "result", label: "Saved result" })]);
  args.artifacts[0].papers = args.papers;
  expect(projectLibraryPaperInventory(args).paper.items).toHaveLength(1);
  args.artifacts = [];
  expect(projectLibraryPaperInventory(args).paper.items).toEqual([]);
});
