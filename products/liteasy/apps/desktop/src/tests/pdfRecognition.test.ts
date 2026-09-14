import { describe, expect, test, vi } from "vitest";
import { buildMetadataPdfFileName, buildPdfRecognitionRequest, selectPdfRecognitionCandidate } from "../app/features/metadata/pdfRecognition";
import { createPdfMetadataImportController } from "../app/controllers/usePdfMetadataImportController";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import type { LiteratureCandidate, LiteratureRecord, LiteratureResolveResult } from "../app/features/paper-identity/literature.types";

const candidate: LiteratureCandidate = {
  candidateKey: "crossref:10.1234/example", provider: "crossref",
  record: { title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017,
    identifiers: [{ kind: "doi", value: "10.1234/example", source: "public_registry" }] }
};
const literature: LiteratureRecord = { ...candidate.record, identifiers: [{ ...candidate.record.identifiers[0], kind: "doi", role: "confirmable", source: "public_registry" }],
  literatureId: "registry-example", revision: 1, status: "confirmed", provenance: { mode: "public_registry", confirmedAt: "2026-09-14T00:00:00Z" } };
const evidence = { firstPageText: "Attention Is All You Need\nAshish Vaswani\ndoi:10.1234/example\nAbstract\nStudy results" };
const exact: LiteratureResolveResult = { status: "exact", candidate, confirmationMode: "candidate", unavailableProviders: [] };

test("uses PDF title only when corroborated by the title page and bounds outgoing text", () => {
  expect(buildPdfRecognitionRequest({ ...evidence, embeddedTitle: "Microsoft Word - draft" })?.hints?.title).toBeUndefined();
  expect(buildPdfRecognitionRequest({ ...evidence, embeddedTitle: candidate.record.title })?.query).toBe(candidate.record.title);
  expect(buildPdfRecognitionRequest(evidence)?.hints?.identifiers).toEqual([{ kind: "doi", value: "10.1234/example" }]);
  expect(buildPdfRecognitionRequest({ firstPageText: "word ".repeat(2000) })!.query!.length).toBeLessThanOrEqual(350);
  expect(buildPdfRecognitionRequest({ firstPageText: "" })).toBeUndefined();
});

test("rejects cited DOIs, competing records, and conflicting results", () => {
  expect(selectPdfRecognitionCandidate(exact, evidence)).toBe(candidate);
  expect(selectPdfRecognitionCandidate(exact, { firstPageText: `A Different Paper\nAbstract\n${evidence.firstPageText}` })).toBeUndefined();
  expect(selectPdfRecognitionCandidate({ status: "ambiguous", candidates: [candidate, { ...candidate, candidateKey: "another-version" }], unavailableProviders: [] }, evidence)).toBeUndefined();
  expect(selectPdfRecognitionCandidate({ status: "conflict", candidates: [candidate], unavailableProviders: [] }, evidence)).toBeUndefined();
  expect(selectPdfRecognitionCandidate(exact, { firstPageText: `${evidence.firstPageText}\narXiv:1706.03762v5` })).toBeUndefined();
  expect(selectPdfRecognitionCandidate({ status: "ambiguous", candidates: [candidate], unavailableProviders: [] }, { firstPageText: candidate.record.title })).toBeUndefined();
});

test("makes portable UTF-8 filenames while leaving the bibliographic title intact", () => {
  expect(buildMetadataPdfFileName(candidate.record)).toBe("Ashish Vaswani - 2017 - Attention Is All You Need.pdf");
  expect(buildMetadataPdfFileName({ title: "CON", authors: [] })).toBe("_CON.pdf");
  const name = buildMetadataPdfFileName({ title: '研究<>:"/\\|?*'.repeat(100), authors: [] });
  expect(name).not.toMatch(/[<>:"/\\|?*]/);
  expect(new TextEncoder().encode(name).length).toBeLessThan(255);
});

function setup(rootPath = "/library") {
  const paper = { id: "paper-1", title: "download", sourcePath: `${rootPath}/download.pdf` };
  const workspaceStore = createWorkspaceStore();
  workspaceStore.openWorkspace([paper], { rootPath, type: "local_library" });
  const resolveLiterature = vi.fn(async (): Promise<LiteratureResolveResult> => exact);
  const confirmLiterature = vi.fn(async () => ({ literature }));
  const persistLiterature = vi.fn(async (value: typeof paper) => ({ ...value, literature }));
  const moveResource = vi.fn(async () => {});
  const onHint = vi.fn();
  const recognize = createPdfMetadataImportController({ workspaceStore,
    literatureClient: { resolveLiterature, confirmLiterature }, persistLiterature, moveResource,
    onHint, onChanged: vi.fn(), stageIdentity: vi.fn(async () => {}) });
  return { paper, workspaceStore, resolveLiterature, confirmLiterature, persistLiterature, moveResource, onHint,
    run: () => recognize({ paper, firstPageText: evidence.firstPageText }),
    runManual: () => recognize({ paper: workspaceStore.getState().papers[0], firstPageText: evidence.firstPageText, manual: true }) };
}

describe("automatic import metadata", () => {
  test("explicit metadata retrieval refreshes an already confirmed paper", async () => {
    const state = setup();
    await state.run();
    state.confirmLiterature.mockResolvedValue({ literature: { ...literature, year: 2018, revision: 2 } });
    state.persistLiterature.mockImplementation(async (paper, ...args: unknown[]) => ({ ...paper, literature: args[0] as LiteratureRecord }));
    expect(await state.runManual()).toContain("已获取");
    expect(state.resolveLiterature).toHaveBeenCalledTimes(2);
    expect(state.workspaceStore.getState().papers[0]).toMatchObject({ year: 2018, literature: { revision: 2 } });
  });
  test.each(["/library", "C:/Library"])("persists metadata and moves the managed file under %s", async (root) => {
    const state = setup(root);
    await state.run();
    expect(state.persistLiterature).toHaveBeenCalledOnce();
    expect(state.moveResource).toHaveBeenCalledWith({ sourcePath: `${root}/download.pdf`, targetPath: `${root}/${buildMetadataPdfFileName(literature)}` });
    expect(state.workspaceStore.getState().papers[0]).toMatchObject({ id: "paper-1", title: literature.title, literature, year: 2017 });
  });
  test("keeps an accessible original path when the disk refuses a rename", async () => {
    const state = setup();
    state.moveResource.mockRejectedValue(new Error("disk error"));
    await state.run();
    expect(state.workspaceStore.getState().papers[0]).toMatchObject({ sourcePath: state.paper.sourcePath, literature });
    expect(state.onHint).toHaveBeenCalledWith(expect.stringContaining("disk error"));
  });
  test("does not confirm or move a paper edited while lookup was pending", async () => {
    const state = setup();
    state.resolveLiterature.mockImplementation(async () => {
      state.workspaceStore.updatePapers([{ ...state.paper, title: "My name" }]);
      return exact;
    });
    await state.run();
    expect(state.confirmLiterature).not.toHaveBeenCalled();
    expect(state.moveResource).not.toHaveBeenCalled();
    expect(state.workspaceStore.getState().papers[0].title).toBe("My name");
  });
  test("does not apply a completed lookup to a different workspace", async () => {
    const state = setup();
    state.resolveLiterature.mockImplementation(async () => {
      state.workspaceStore.openWorkspace([state.paper], { rootPath: "/other", type: "local_library" });
      return exact;
    });
    await state.run();
    expect(state.confirmLiterature).not.toHaveBeenCalled();
  });
  test("suffixes collisions and leaves external linked files alone", async () => {
    const state = setup();
    state.workspaceStore.addPaper({ id: "other", title: literature.title, sourcePath: `/library/${buildMetadataPdfFileName(literature)}` });
    await state.run();
    expect(state.workspaceStore.getState().papers[0].sourcePath).toMatch(/ \(2\)\.pdf$/);
    const external = setup("blob:example");
    await external.run();
    expect(external.moveResource).not.toHaveBeenCalled();
  });
  test("network failure preserves the PDF and permits retry", async () => {
    const state = setup();
    state.resolveLiterature.mockRejectedValueOnce(new Error("offline"));
    await state.run();
    expect(state.workspaceStore.getState().papers[0]).toEqual(state.paper);
    await state.run();
    expect(state.moveResource).toHaveBeenCalledOnce();
  });
  test("falls back from a missing DOI to a corroborated bibliographic search", async () => {
    const state = setup();
    state.resolveLiterature.mockResolvedValueOnce({ status: "not_found", candidates: [], unavailableProviders: [] })
      .mockResolvedValueOnce({ status: "ambiguous", candidates: [candidate], unavailableProviders: [] });
    await state.run();
    expect(state.resolveLiterature).toHaveBeenCalledTimes(2);
    expect(state.moveResource).toHaveBeenCalledOnce();
  });
  test("preserves edits made while the filesystem move was pending", async () => {
    const state = setup();
    state.moveResource.mockImplementation(async () => {
      state.workspaceStore.updatePapers([{ ...state.paper, title: "My preferred title" }]);
    });
    await state.run();
    expect(state.workspaceStore.getState().papers[0]).toMatchObject({ title: "My preferred title", sourcePath: `/library/${buildMetadataPdfFileName(literature)}` });
  });
});
