import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import { applyBibliographicMetadata, bibliographicDraft } from "../app/features/library/bibliographicFields";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";
import { useReadingLibraryController } from "../app/controllers/useReadingLibraryController";
import { useBibliographicMetadataController } from "../app/controllers/useBibliographicMetadataController";

const entry: ReadingCatalogEntry = { id: "paper", title: "Registry title", authors: ["Registry Author"], year: 2024, publishedAt: "2024-03", doi: "10.1234/old", format: "pdf", physicalPath: "/library/paper.pdf" };
function fixture() {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  return { scope, storage, repository: createReadingLibraryRepository(storage, scope) };
}

test("editing an ebook does not mislabel or discard its non-ISBN identifier", () => {
  const book: ReadingCatalogEntry = { ...entry, format: "epub", identifier: "urn:uuid:book-identity" };
  const draft = bibliographicDraft(book);
  expect(draft.isbn).toBe("");
  expect(applyBibliographicMetadata(book, { ...draft, version: 1, revision: 1, updatedAt: "2026-10-02" }).identifier).toBe(book.identifier);
  expect(bibliographicDraft({ ...book, identifier: "urn:isbn:978-1-0981-1906-5" }).isbn).toBe("978-1-0981-1906-5");
});

test("manual bibliography persists rich fields and intentional clearing, preserving file identity and classification", async () => {
  const { scope, repository, storage } = fixture();
  await repository.updateMetadata(entry.id, { tags: ["经典"], folderPath: "Books", readingStatus: "finished" });
  const draft = { ...bibliographicDraft(entry), title: "Designing data-intensive applications", assetType: "book", authors: ["Kleppmann, Martin", "Riccomini, Chris"],
    publishedAt: "", doi: "", publisher: "O'Reilly", edition: "2nd edition", isbn: "978-1-0981-1906-5", abstract: "Reliable systems." };
  const saved = await repository.saveBibliography(entry.id, draft, 0);
  const reopened = await createReadingLibraryRepository(storage, scope).metadata();
  expect(reopened[entry.id]).toEqual(saved);
  expect(saved).toMatchObject({ tags: ["经典"], folderPath: "Books", readingStatus: "finished" });
  expect(applyBibliographicMetadata(entry, saved.bibliographic)).toMatchObject({ ...draft, id: entry.id, physicalPath: entry.physicalPath, year: undefined, bibliographicRevision: 1 });
  await expect(repository.saveBibliography(entry.id, { ...draft, title: "Stale overwrite" }, 0)).rejects.toThrow("其他位置修改");
  expect((await repository.metadata())[entry.id]).toEqual(saved);
  await repository.updateMetadata(entry.id, { authors: ["Revised Author"], year: 2026, assetType: "report" });
  expect(applyBibliographicMetadata(entry, (await repository.metadata())[entry.id].bibliographic)).toMatchObject({ authors: ["Revised Author"], year: 2026, publishedAt: "2026", assetType: "report", bibliographicRevision: 2 });
});

test("future or damaged bibliography stays readable but is never overwritten by an older editor", async () => {
  const { repository } = fixture();
  const future = { version: 9, title: "Future record", opaque: { preserve: true } };
  await repository.updateMetadata(entry.id, { bibliographic: future });
  expect(applyBibliographicMetadata(entry, future)).toEqual(entry);
  await expect(repository.saveBibliography(entry.id, bibliographicDraft(entry), 0)).rejects.toThrow("无法安全编辑");
  expect((await repository.metadata())[entry.id].bibliographic).toEqual(future);
});

test("PDF selection and reopened library use saved metadata without changing the source or its path", async () => {
  const input = { scopeId: crypto.randomUUID(), papers: [{ id: entry.id, title: entry.title, authors: entry.authors, year: "2024", sourcePath: entry.physicalPath }], enabled: true,
    importPdfs: vi.fn(async () => {}), openPaper: vi.fn(), onOpenReader: vi.fn() };
  const hook = renderHook(() => useReadingLibraryController(input));
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  act(() => hook.result.current.inspect(hook.result.current.entries[0]));
  const path = hook.result.current.selected?.liteasyPath;
  await act(async () => { await hook.result.current.saveBibliography(entry.id, { ...bibliographicDraft(entry), title: "Edited title", authors: ["New Author"] }, 0); });
  expect(hook.result.current.selected).toMatchObject({ title: "Edited title", authors: ["New Author"], liteasyPath: path, physicalPath: entry.physicalPath });
  expect(input.papers[0].title).toBe("Registry title");
  hook.unmount();
  const reopened = renderHook(() => useReadingLibraryController(input));
  await waitFor(() => expect(reopened.result.current.entries[0].title).toBe("Edited title"));
  reopened.unmount();
});

test("editor retains draft after failure and cannot carry it into another account", async () => {
  const save = vi.fn(async () => { throw new Error("磁盘不可写"); });
  const hook = renderHook(({ scope }) => useBibliographicMetadataController({ scope, entries: [entry], save }), { initialProps: { scope: "user-a" } });
  act(() => { hook.result.current.open(entry); });
  act(() => { hook.result.current.change({ title: "User draft" }); });
  await act(async () => { await hook.result.current.save(); });
  expect(hook.result.current.error).toBe("磁盘不可写");
  expect(hook.result.current.draft?.title).toBe("User draft");
  expect(hook.result.current.dirty).toBe(true);
  hook.rerender({ scope: "user-b" });
  expect(hook.result.current.entry).toBeUndefined();
  expect(hook.result.current.draft).toBeUndefined();
  act(() => { hook.result.current.open(entry); });
  expect(hook.result.current.draft?.title).toBe(entry.title);
});
