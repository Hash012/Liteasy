import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { createObjectStorage, type StorageRow, type ObjectStorage } from "../app/features/objects/objectStorage";
import { ObjectWorkbenchContext, type ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import { buildOriginalReaderPaper, type OriginalFileDescriptor } from "../app/features/original-files/originalFileService";
import type { Paper } from "../app/features/workspace/workspace.types";

vi.mock("../app/features/objects/objectStorage", () => ({ createObjectStorage: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (load) => ({ ...await load<object>(), getDocument: vi.fn() }));
const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic position test");
const original: OriginalFileDescriptor = { id: "grant-before-restart", path: "/synthetic/book.pdf", fileName: "book.pdf", format: "pdf", sizeBytes: bytes.length, modifiedUnixMs: 1 };
const rows = new Map<string, StorageRow>();
const loadPdfSource = vi.fn(async () => bytes.slice());
const storage: ObjectStorage = {
  get: vi.fn(async (key) => rows.get(key) ?? null), list: vi.fn(async () => []),
  commit: vi.fn(async (changes) => { for (const change of changes) {
    if ((rows.get(change.key)?.version ?? null) !== change.expected) throw new Error("revision_conflict");
    if (change.row) rows.set(change.key, change.row);
  } })
};
const port = { scopeId: "local" } as ObjectWorkbenchPort;
function proxy(): PDFDocumentProxy {
  return { numPages: 6, fingerprints: ["synthetic-pdf", null], getPage: vi.fn(async () => ({ getViewport: () => ({ width: 600, height: 800 }), cleanup: vi.fn() })), destroy: vi.fn(async () => {}), getDownloadInfo: vi.fn(async () => ({ length: bytes.length })) } as unknown as PDFDocumentProxy;
}
function view(paper: Paper, targetEvidence?: { paperId: string; page: number; requestId: number; evidenceId: string; quote: string }) {
  return <ObjectWorkbenchContext.Provider value={port}><PdfReader selectedPapers={[paper]} zoom={100} loadPdfSource={loadPdfSource} targetEvidence={targetEvidence} /></ObjectWorkbenchContext.Provider>;
}
function checkpoint(paper: Paper, page = 4) {
  const key = `reader-state/pdf/${paper.id}`;
  rows.set(key, { key, version: "before-reopen", value: { schemaVersion: 1, paperId: paper.id, contentRevision: `sha256:${paper.contentHash}`, page, updatedAt: "2026-10-03T00:00:00.000Z" } });
}
beforeEach(() => {
  rows.clear(); vi.clearAllMocks(); localStorage.clear();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("PDF position integration test");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.mocked(createObjectStorage).mockReturnValue(storage);
  vi.mocked(pdfjs.getDocument).mockImplementation(() => ({ promise: Promise.resolve(proxy()), destroy: vi.fn() }) as never);
});
afterEach(() => vi.restoreAllMocks());

test("explicitly reopening identical PDF bytes with a new grant restores its saved page after load", async () => {
  const first = await buildOriginalReaderPaper(original, bytes);
  const mounted = render(view(first));
  await screen.findByLabelText("共 6 页");
  const page = screen.getByRole("spinbutton", { name: "当前页码" });
  fireEvent.change(page, { target: { value: "4" } }); fireEvent.keyDown(page, { key: "Enter" });
  await waitFor(() => expect((rows.get(`reader-state/pdf/${first.id}`)?.value as { page: number })?.page).toBe(4));
  mounted.unmount();
  const reopened = await buildOriginalReaderPaper({ ...original, id: "fresh-explicit-grant" }, bytes);
  render(view(reopened));
  await waitFor(() => expect(screen.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(4));
  expect(loadPdfSource).toHaveBeenCalledTimes(2);
});

test("a changed same-path document never hydrates or saves through the old PDF proxy", async () => {
  const first = await buildOriginalReaderPaper(original, bytes);
  checkpoint(first);
  const mounted = render(view(first));
  await waitFor(() => expect(screen.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(4));
  let complete!: (document: PDFDocumentProxy) => void;
  vi.mocked(pdfjs.getDocument).mockImplementationOnce(() => ({ promise: new Promise((resolve) => { complete = resolve; }), destroy: vi.fn() }) as never);
  const second = await buildOriginalReaderPaper({ ...original, id: "new-grant" }, new TextEncoder().encode("%PDF-1.7\nchanged bytes"));
  mounted.rerender(view(second));
  await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(2));
  expect(storage.get).not.toHaveBeenCalledWith(`reader-state/pdf/${second.id}`);
  expect(rows.has(`reader-state/pdf/${second.id}`)).toBe(false);
  await act(async () => { complete(proxy()); });
  await screen.findByLabelText("共 6 页");
  expect(screen.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(1);
});

test("evidence navigation wins over saved page when PDF page count becomes available", async () => {
  const paper = await buildOriginalReaderPaper(original, bytes); checkpoint(paper);
  render(view(paper, { paperId: paper.id, page: 3, requestId: 1, evidenceId: "explicit-evidence", quote: "Synthetic quote" }));
  await screen.findByLabelText("共 6 页");
  await waitFor(() => expect(screen.getByRole("spinbutton", { name: "当前页码" })).toHaveValue(3));
  await waitFor(() => expect((rows.get(`reader-state/pdf/${paper.id}`)?.value as { page: number }).page).toBe(3));
});
