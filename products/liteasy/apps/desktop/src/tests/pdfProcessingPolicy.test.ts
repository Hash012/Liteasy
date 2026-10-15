import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { createImportStore } from "../app/features/import/import.store";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import { useWorkspaceActions } from "../app/features/workspace/useWorkspaceActions";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { projectPdfCapabilities } from "../app/features/import/pdfCapabilities";
import { usePdfProcessingController } from "../app/controllers/usePdfProcessingController";
import { createSettingsStore } from "../app/features/settings/settings.store";
beforeEach(() => vi.stubGlobal("crypto", webcrypto));

test("100 default imports persist files without heavy work; first open prepares once and manual stays deferred", async () => {
  const workspaceStore = createWorkspaceStore(), importStore = createImportStore();
  workspaceStore.openWorkspace([], { type: "local_library", rootPath: "/library" });
  const extract = vi.fn(async (paper) => [{ paperId: paper.id, paperTitle: paper.title, page: 1, snippet: "native text", summary: "", tags: [] }]);
  const actions = useWorkspaceActions({ workspaceStore, importStore, extractPaperChunks: extract,
    persistDroppedPdfFiles: async () => ({ rootPath: "/library", entries: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, title: `p${i}`, path: `/library/${i}.pdf` })) }),
    onAnalysisHint() {}, onWorkspaceChanged() {}, onImportJobsChanged() {} });
  await actions.addDroppedPdfFiles(Array.from({ length: 100 }, (_, i) => new File(["pdf"], `${i}.pdf`)));
  expect(workspaceStore.getState().papers).toHaveLength(100); expect(importStore.listJobs()).toHaveLength(0); expect(extract).not.toHaveBeenCalled();
  const paper = workspaceStore.getState().papers[0];
  actions.prepareOpenedPaper(paper); actions.prepareOpenedPaper(paper);
  await waitFor(() => expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("parsed"));
  actions.prepareOpenedPaper(paper); expect(extract).toHaveBeenCalledTimes(1);
  await actions.setPaperProcessingPolicy(workspaceStore.getState().papers[1], "manual");
  await actions.prepareOpenedPaper(workspaceStore.getState().papers[1]);
  expect(importStore.listJobs()).toHaveLength(1);
});

test("document policy survives a restarted controller and first open waits for its durable value", async () => {
  const settings = createSettingsStore(), workspaceStore = createWorkspaceStore(), importStore = createImportStore();
  const paper = { id: crypto.randomUUID(), title: "Manual", sourcePath: "/manual.pdf" };
  workspaceStore.openWorkspace([paper], { type: "local_library", rootPath: "/library" });
  const extract = vi.fn();
  const hook = renderHook(() => usePdfProcessingController(settings, workspaceStore, vi.fn()));
  await act(async () => { await hook.result.current.processingReady(); });
  const options = { workspaceStore, importStore, extractPaperChunks: extract, onAnalysisHint: vi.fn(), onWorkspaceChanged() {}, onImportJobsChanged() {} };
  const first = useWorkspaceActions({ ...options, ...hook.result.current });
  await act(async () => { await first.setPaperProcessingPolicy(paper, "manual"); });
  hook.unmount(); workspaceStore.updatePapers([paper]);
  const reopened = renderHook(() => usePdfProcessingController(settings, workspaceStore, vi.fn()));
  const second = useWorkspaceActions({ ...options, ...reopened.result.current });
  await act(async () => { await second.prepareOpenedPaper(paper); });
  expect(workspaceStore.getState().papers[0].processingPolicy).toBe("manual");
  expect(extract).not.toHaveBeenCalled(); expect(importStore.listJobs()).toHaveLength(0);
  reopened.unmount();
});

test("recipe changes reject late work; cancellation and failed persistence cannot publish ready results", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), store = createImportStore();
  let recipe = "pdf/v1", finish!: () => void;
  const first = store.schedule({ key: recipe, storage, active: () => recipe === "pdf/v1" }, async () => { await new Promise<void>(resolve => { finish = resolve; }); return "old"; });
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(finish).toBeDefined()); recipe = "pdf/v2"; finish(); await rejected;
  expect(await storage.list("imports/results/")).toHaveLength(0);
  expect(await store.schedule({ key: recipe, storage, active: () => true }, async () => "new")).toBe("new");
  const cancelled = store.schedule({ key: "cancel", storage, active: () => true }, async signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
  const cancellation = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(async () => expect(await storage.get("imports/processing-lease/v1")).toBeTruthy());
  store.cancel("cancel"); await cancellation;
  const failing = { ...storage, commit: vi.fn(async (changes: Parameters<typeof storage.commit>[0]) => {
    if (changes.some(change => change.key.startsWith("imports/results/"))) throw new Error("Disk full");
    return storage.commit(changes);
  }) };
  await expect(store.schedule({ key: "disk-full", storage: failing, active: () => true }, async () => "never ready")).rejects.toThrow("Disk full");
  expect(await storage.list("imports/results/")).toHaveLength(1);
});

test("two windows coalesce identical work through existing durable CAS and reject late results", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), a = createImportStore(), b = createImportStore();
  let finish!: () => void;
  const run = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { text: "durable" }; });
  const options = { key: "source-hash/fulltext/recipe/options", storage, active: () => true };
  const first = a.schedule(options, run), second = b.schedule(options, run);
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1)); finish();
  expect(await first).toEqual({ text: "durable" }); expect(await second).toEqual({ text: "durable" }); expect(run).toHaveBeenCalledTimes(1);
  let active = true;
  await expect(a.schedule({ ...options, key: "changed-source", active: () => active }, async () => { active = false; return "late"; })).rejects.toMatchObject({ name: "AbortError" });
  expect(await storage.list("imports/results/")).toHaveLength(1);
});

test("a parsed job does not claim glyphs, OCR, figures or search indexing are ready", () => {
  const capability = projectPdfCapabilities({ id: "p", title: "P", sourcePath: "/p.pdf" }, { id: "j", documentId: "p", sourcePath: "/p.pdf", status: "parsed", parsedChunks: [{ paperId: "p", paperTitle: "P", page: 3, snippet: "text", summary: "", tags: [] }] });
  expect(capability.structuredFulltext).toMatchObject({ state: "partial", pages: [3] });
  for (const key of ["textSelection", "pageRaster", "pageOcr", "figures", "searchIndex"] as const) expect(capability[key].state).toBe("unknown");
});

test.each(["manual", "on-import"] as const)("%s policy controls automatic work without disabling explicit preparation", async policy => {
  const workspaceStore = createWorkspaceStore(), importStore = createImportStore();
  workspaceStore.openWorkspace([], { type: "local_library", rootPath: "/library" });
  const extract = vi.fn(async (paper) => [{ paperId: paper.id, paperTitle: paper.title, page: 1, snippet: "text", summary: "", tags: [] }]);
  const actions = useWorkspaceActions({ workspaceStore, importStore, extractPaperChunks: extract, processingPolicy: () => policy,
    persistDroppedPdfFiles: async () => ({ rootPath: "/library", entries: [{ id: "policy-paper", title: "Policy", path: "/library/p.pdf" }] }),
    onAnalysisHint() {}, onWorkspaceChanged() {}, onImportJobsChanged() {} });
  await actions.addDroppedPdfFiles([new File(["pdf"], "p.pdf")]);
  const paper = workspaceStore.getState().papers[0];
  if (policy === "manual") { await actions.prepareOpenedPaper(paper); expect(extract).not.toHaveBeenCalled(); actions.queueImportForPapers([paper]); }
  await waitFor(() => expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("parsed"));
  expect(extract).toHaveBeenCalledOnce();
});

test("fulltext write failure prevents ready publication and a successful retry publishes after the write", async () => {
  const workspaceStore = createWorkspaceStore(), importStore = createImportStore(), paper = { id: "persist", title: "Persist", sourcePath: "/library/p.pdf" };
  workspaceStore.openWorkspace([paper], { type: "local_library", rootPath: "/library" });
  const save = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockImplementationOnce(async () => {
    expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("parsing");
  });
  const actions = useWorkspaceActions({ workspaceStore, importStore, savePaperArtifact: save,
    extractPaperIndex: async () => ({ chunks: [{ paperId: paper.id, paperTitle: paper.title, page: 1, snippet: "text", summary: "", tags: [] }], pages: [{ page: 1, text: "text" }] }),
    onAnalysisHint() {}, onWorkspaceChanged() {}, onImportJobsChanged() {} });
  actions.queueImportForPapers([paper]);
  await waitFor(() => expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("failed"));
  expect(importStore.getParsedChunksByDocumentId(paper.id)).toEqual([]);
  actions.queueImportForPapers([paper]);
  await waitFor(() => expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("parsed"));
  expect(save).toHaveBeenCalledTimes(2);
});
