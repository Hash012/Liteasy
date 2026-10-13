import { describe, expect, test, vi } from "vitest";
import { createArtifactLocalRepository } from "../app/features/artifacts/artifactLocalRepository";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { artifactMetadataIssueCount } from "../app/features/artifacts/artifactMetadataProjection";
import { artifactSearchText, groupArtifactsByPaper, indexArtifactPapers } from "../app/features/artifacts/artifactLibraryIndex";

describe("artifact metadata admission and preservation", () => {
  test.each([{}, [null], [{ id: "ok", title: "Readable" }, { id: "bad", title: 42 }]])("isolates bad papers %j without changing or replacing the source", async (papers) => {
    const snapshot = { version: "liteasy.artifact-catalog/v1", artifacts: [{ artifactId: "a", title: "Saved", type: "tree", papers }] };
    const bytes = JSON.stringify(snapshot);
    const save = vi.fn(async () => undefined);
    const repository = createArtifactLocalRepository({ load: async () => snapshot, save });
    const [artifact] = await repository.list();
    expect(artifact.title).toBe("Saved");
    expect(artifactMetadataIssueCount(artifact)).toBe(1);
    expect(() => indexArtifactPapers([artifact])).not.toThrow();
    expect(() => groupArtifactsByPaper([artifact], "")).not.toThrow();
    expect(() => artifactSearchText(artifact)).not.toThrow();
    expect(JSON.stringify(snapshot)).toBe(bytes);
    await expect(repository.replace([artifact])).rejects.toThrow("只读");
    await expect(repository.replace([])).rejects.toThrow("只读");
    expect(save).not.toHaveBeenCalled();
    expect(repository.getReadStatus?.()).toEqual({ issueCount: 1, readOnly: true });
  });

  test.each([undefined, [{ id: "p", title: "Paper", authors: ["Author"], year: 2026 }]])("normal and missing papers remain writable", async (papers) => {
    const original = { artifactId: "a", title: "Saved", type: "tree" as const, ...(papers ? { papers } : {}) };
    const save = vi.fn(async () => undefined);
    const repository = createArtifactLocalRepository({ load: async () => ({ version: "liteasy.artifact-catalog/v1", artifacts: [original] }), save });
    const rows = await repository.list();
    expect(rows).toEqual([original]);
    await repository.replace(rows);
    expect(save).toHaveBeenCalledOnce();
  });

  test.each([
    { version: "future/version", artifacts: [{ privateField: "preserve" }] },
    { version: "liteasy.artifact-catalog/v1", artifacts: [null, { artifactId: "a", title: "Readable", type: "tree" }] }
  ])("unknown records protect the entire snapshot from automatic replace", async (snapshot) => {
    const bytes = JSON.stringify(snapshot);
    const save = vi.fn(async () => undefined);
    const repository = createArtifactLocalRepository({ load: async () => snapshot, save });
    const projected = await repository.list();
    await expect(repository.replace(projected)).rejects.toThrow("原始资料");
    expect(JSON.stringify(snapshot)).toBe(bytes);
    expect(save).not.toHaveBeenCalled();
  });

  test("store admission projects metadata even outside the cache transport", () => {
    const store = createArtifactStore();
    store.upsertCatalogEntry({ artifactId: "a", title: "Saved", type: "tree", papers: [null], createdAt: 42 } as never);
    expect(() => indexArtifactPapers(store.getCatalog())).not.toThrow();
    expect(artifactMetadataIssueCount(store.getCatalog()[0])).toBe(2);
  });
});


test("browser cache bytes remain identical after reading and refusing to replace a quarantined snapshot", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const key = "liteasy.artifact-catalog.v1";
  const bytes = ' { "version": "liteasy.artifact-catalog/v1", "artifacts": [{ "artifactId": "a", "title": "Saved", "type": "tree", "papers": [null], "futureMetadata": {"preserve":true} }] } ';
  window.localStorage.setItem(key, bytes);
  try {
    const repository = createArtifactLocalRepository();
    const rows = await repository.list();
    await expect(repository.replace(rows)).rejects.toThrow("只读");
    expect(window.localStorage.getItem(key)).toBe(bytes);
  } finally { window.localStorage.removeItem(key); vi.unstubAllGlobals(); }
});


test("one thousand lightweight records retain valid sources and isolate corrupt metadata without saving", async () => {
  const artifacts = Array.from({ length: 1000 }, (_, index) => ({ artifactId: `synthetic-${index}`, title: `Synthetic ${index}`, type: "tree", papers: index % 10 === 0 ? [null] : [{ id: `paper-${index % 9}`, title: `Paper ${index % 9}` }] }));
  const original = { version: "liteasy.artifact-catalog/v1", artifacts }, bytes = JSON.stringify(original), save = vi.fn(async () => undefined);
  const repository = createArtifactLocalRepository({ load: async () => original, save });
  const rows = await repository.list();
  expect(rows).toHaveLength(1000);
  expect(indexArtifactPapers(rows).reduce((sum, item) => sum + item.count, 0)).toBe(900);
  expect(groupArtifactsByPaper(rows, "").reduce((sum, group) => sum + group.artifacts.length, 0)).toBe(1000);
  expect(repository.getReadStatus?.()).toEqual({ issueCount: 100, readOnly: true });
  await expect(repository.replace(rows)).rejects.toThrow("只读");
  expect(save).not.toHaveBeenCalled(); expect(JSON.stringify(original)).toBe(bytes);
});
