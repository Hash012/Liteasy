import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { usePaperProjectsController } from "../app/controllers/usePaperProjectsController";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { objectText } from "../app/features/objects/object.types";
import { loadUserPaperArtifact, PAPER_FULLTEXT_SAVED_EVENT } from "../app/features/library/userPaperArtifactClient";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";
import type { MineruFigure } from "../app/features/import/import.types";
import type { Paper } from "../app/features/workspace/workspace.types";

vi.mock("../app/features/library/userPaperArtifactClient", async (original) => ({
  ...await original<typeof import("../app/features/library/userPaperArtifactClient")>(),
  loadUserPaperArtifact: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(loadUserPaperArtifact).mockReset();
  vi.mocked(loadUserPaperArtifact).mockResolvedValue(undefined);
});

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wSAAAAAASUVORK5CYII=";
const papers: Paper[] = [{ id: "paper-a", title: "论文 A", contentHash: "hash-a" }, { id: "paper-b", title: "论文 B", contentHash: "hash-b" }];
const figure: MineruFigure = { id: "figure-1", page: 2, alt: "原图图注", dataUrl: png, sourcePath: "figure.png", analysis: { description: "AI 推测，不应变成原文", importance: "primary", kind: "chart", placement: "results", selectionReason: "辅助说明", title: "推测标题" } };
function input(overrides: Partial<Parameters<typeof usePaperProjectsController>[0]> = {}) {
  return {
    scopeId: crypto.randomUUID(), papers, artifacts: [] as ArtifactTab[], extractionVersion: 1,
    getResources: () => null,
    ...overrides,
  };
}
function objects(scopeId: string) {
  return createObjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("every paper automatically owns real immutable page/image sources and source navigation anchors", async () => {
  vi.mocked(loadUserPaperArtifact).mockImplementation(async ({ paperId }) => ({ pages: [{ page: 1, text: `${paperId} 完整原文` }] }));
  const props = input({ getResources: (paperId) => paperId === "paper-a" ? { figures: [figure], textChunks: [{ paperId, paperTitle: "论文 A", page: 1, snippet: "部分片段", summary: "摘要", tags: [] }] } : null });
  const hook = renderHook(usePaperProjectsController, { initialProps: props });
  await waitFor(() => expect(hook.result.current.catalog.reduce((count, item) => count + item.assets.length, 0)).toBe(3));
  expect(hook.result.current.catalog).toHaveLength(2);
  expect(hook.result.current.error).toBe("");
  const repository = objects(props.scopeId);
  const project = hook.result.current.catalog.find((item) => item.project.paperId === "paper-a")!;
  const text = await repository.get(project.assets.find((asset) => asset.kind === "text")!.ref!);
  expect(text.kind).toBe("source.document");
  expect(objectText(text)).toBe("paper-a 完整原文");
  expect(text.paperAnchors?.[0]).toMatchObject({ source: { paperId: "paper-a", documentHash: "hash-a" }, locator: { page: 1 }, snapshot: { quote: "paper-a 完整原文" } });
  const image = await repository.get(project.assets.find((asset) => asset.kind === "image")!.ref!);
  expect(objectText(image)).toBe("原图图注");
  expect(image.paperAnchors?.[0].locator.page).toBe(2);
  expect((await repository.readAsset(image.assets[0].assetId)).base64).toBe(png.split(",")[1]);
  await expect(repository.editNote(project.assets[0].ref!, "篡改原文")).rejects.toMatchObject({ code: "capability_denied" });
  hook.unmount();
});

test("multi-paper artifacts and shared source references attach to every matching project without rereading sources", async () => {
  vi.mocked(loadUserPaperArtifact).mockImplementation(async ({ paperId }) => ({ pages: [{ page: 1, text: paperId }] }));
  const comparison: ArtifactTab = { artifactId: "comparison", title: "多论文比较", type: "comparison_table", papers };
  const props = input({ artifacts: [comparison] });
  const hook = renderHook(usePaperProjectsController, { initialProps: props });
  await waitFor(() => expect(hook.result.current.catalog.every((item) => item.assets.some((asset) => asset.artifactId === "comparison")) && hook.result.current.catalog.length === 2).toBe(true));
  const first = hook.result.current.catalog.find((item) => item.project.paperId === "paper-a")!;
  const second = hook.result.current.catalog.find((item) => item.project.paperId === "paper-b")!;
  const shared = first.assets.find((asset) => asset.kind === "text")!;
  await act(async () => { await hook.result.current.repository.addAsset(second.project.projectId, { ...shared, assetId: "shared-a", role: "reference" }); });
  const byRef: ArtifactTab = { artifactId: "based-on-shared", title: "共享原文的解释", type: "tree", sourceContextRefs: [shared.ref!] };
  hook.rerender({ ...props, artifacts: [comparison, byRef] });
  await waitFor(() => expect(hook.result.current.catalog.every((item) => item.assets.some((asset) => asset.artifactId === "based-on-shared")) && !hook.result.current.busy).toBe(true));
  expect(loadUserPaperArtifact).toHaveBeenCalledTimes(2);
  const revisions = hook.result.current.catalog.flatMap((item) => item.assets.map((asset) => asset.ref?.revision));
  hook.rerender({ ...props, papers: papers.map((paper) => ({ ...paper })), artifacts: [{ ...comparison }, { ...byRef }] });
  expect(hook.result.current.catalog.flatMap((item) => item.assets.map((asset) => asset.ref?.revision))).toEqual(revisions);
  expect(loadUserPaperArtifact).toHaveBeenCalledTimes(2);
  hook.unmount();
});

test("one damaged image or unreadable paper leaves other sources and all artifacts usable", async () => {
  vi.mocked(loadUserPaperArtifact).mockImplementation(async ({ paperId }) => {
    if (paperId === "paper-a") throw new Error("正文读取失败");
    return { pages: [{ page: 1, text: "B 原文" }] };
  });
  const props = input({ artifacts: [{ artifactId: "artifact", title: "比较", type: "tree", papers }], getResources: (paperId) => paperId === "paper-a" ? {
    figures: [{ ...figure, id: "broken", alt: "损坏原图", dataUrl: "data:image/png;base64,broken" }, figure],
    textChunks: [{ paperId, paperTitle: "论文 A", page: 3, snippet: "仍可用的识别正文", summary: "", tags: [] }],
  } : null });
  const hook = renderHook(usePaperProjectsController, { initialProps: props });
  await waitFor(() => expect(hook.result.current.error).toContain("部分项目资产暂未保存"));
  await waitFor(() => expect(hook.result.current.catalog.reduce((count, item) => count + item.assets.length, 0)).toBe(5));
  expect(hook.result.current.error).toContain("损坏原图");
  expect(hook.result.current.error).toContain("正文读取失败");
  expect(hook.result.current.catalog.every((item) => item.assets.some((asset) => asset.artifactId === "artifact"))).toBe(true);
  hook.unmount();
});

test("generated artifacts return to persisted source projects outside the current workspace", async () => {
  const props = input({ papers: [papers[1]] });
  const repository = createPaperProjectRepository(createObjectStorage(props.scopeId, () => props.scopeId), props.scopeId);
  const savedProject = await repository.ensurePaperProject({ paperId: "paper-a", title: "已移出工作区的论文 A" });
  const source = await repository.registerSource(savedProject.projectId, { assetId: "text:1", paperId: "paper-a", title: "A 原文", kind: "text", text: "仍保留的原文", page: 1 });
  const byRef: ArtifactTab = { artifactId: "return-by-ref", title: "根据 A 原文生成", type: "tree", sourceContextRefs: [source.ref!] };
  const byPaper: ArtifactTab = { artifactId: "return-by-paper", title: "根据论文 A 生成", type: "tree", papers: [papers[0]] };
  const hook = renderHook(usePaperProjectsController, { initialProps: { ...props, artifacts: [byRef, byPaper] } });
  await waitFor(() => expect(hook.result.current.catalog.find((item) => item.project.projectId === savedProject.projectId)?.assets.filter((asset) => asset.kind === "artifact")).toHaveLength(2));
  expect(hook.result.current.catalog.find((item) => item.project.paperId === "paper-b")?.assets).toEqual([]);
  expect(loadUserPaperArtifact).toHaveBeenCalledExactlyOnceWith({ artifactKind: "fulltext", paperId: "paper-b" });
  expect((await repository.listAssets(savedProject.projectId)).find((asset) => asset.role === "source")?.ref).toEqual(source.ref);
  hook.unmount();
});

test("late extraction from an old account cannot delay or publish into the new account", async () => {
  const delayed = deferred<unknown>();
  vi.mocked(loadUserPaperArtifact).mockImplementation(async ({ paperId }) => paperId === "old-paper" ? delayed.promise : { pages: [{ page: 1, text: "新账号原文" }] });
  const oldProps = input({ papers: [{ id: "old-paper", title: "旧账号论文" }] });
  const hook = renderHook(usePaperProjectsController, { initialProps: oldProps });
  await waitFor(() => expect(loadUserPaperArtifact).toHaveBeenCalledWith({ artifactKind: "fulltext", paperId: "old-paper" }));
  const newProps = input({ papers: [{ id: "new-paper", title: "新账号论文" }] });
  hook.rerender(newProps);
  expect(hook.result.current.catalog).toEqual([]);
  await waitFor(() => expect(hook.result.current.catalog[0]?.assets).toHaveLength(1));
  await act(async () => { delayed.resolve({ pages: [{ page: 1, text: "迟到的旧账号原文" }] }); });
  expect(hook.result.current.catalog.map((item) => item.project.paperId)).toEqual(["new-paper"]);
  expect((await objects(newProps.scopeId).search()).objects.map(objectText)).toEqual(["新账号原文"]);
  expect((await objects(oldProps.scopeId).search()).objects).toEqual([]);
  hook.unmount();
});

test("reader fulltext save notifications debounce page updates and reread only the changed paper", async () => {
  let updated = false;
  vi.mocked(loadUserPaperArtifact).mockImplementation(async ({ paperId }) => ({ pages: [{ page: 1, text: paperId === "paper-a" && updated ? "更新后的原文" : `${paperId} 原文` }] }));
  const props = input();
  const hook = renderHook(usePaperProjectsController, { initialProps: props });
  await waitFor(() => expect(hook.result.current.catalog.reduce((count, item) => count + item.assets.length, 0)).toBe(2));
  const original = hook.result.current.catalog.find((item) => item.project.paperId === "paper-a")!.assets[0].ref!;
  updated = true;
  act(() => {
    for (let index = 0; index < 5; index += 1) window.dispatchEvent(new CustomEvent(PAPER_FULLTEXT_SAVED_EVENT, { detail: "paper-a" }));
    window.dispatchEvent(new CustomEvent(PAPER_FULLTEXT_SAVED_EVENT, { detail: "unrelated-paper" }));
  });
  await waitFor(() => expect(hook.result.current.catalog.find((item) => item.project.paperId === "paper-a")?.assets[0].ref?.revision).not.toBe(original.revision));
  const latest = hook.result.current.catalog.find((item) => item.project.paperId === "paper-a")!.assets[0].ref!;
  expect(latest.objectId).toBe(original.objectId);
  expect(objectText(await objects(props.scopeId).get(latest))).toBe("更新后的原文");
  expect(objectText(await objects(props.scopeId).get(original))).toBe("paper-a 原文");
  expect(loadUserPaperArtifact).toHaveBeenCalledTimes(3);
  hook.unmount();
});
