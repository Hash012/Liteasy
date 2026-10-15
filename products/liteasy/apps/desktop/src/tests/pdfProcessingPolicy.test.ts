import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { createImportStore } from "../app/features/import/import.store";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import { useWorkspaceActions } from "../app/features/workspace/useWorkspaceActions";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { projectPdfCapabilities } from "../app/features/import/pdfCapabilities";
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
  actions.prepareOpenedPaper({ ...workspaceStore.getState().papers[1], processingPolicy: "manual" });
  expect(importStore.listJobs()).toHaveLength(1);
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
