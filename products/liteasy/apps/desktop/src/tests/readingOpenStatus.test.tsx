import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useReadingLibraryController } from "../app/controllers/useReadingLibraryController";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { savePaperFileMetadata } from "../app/features/library/paperFileMetadata";

function setup() {
  const scopeId = `pdf-status-${crypto.randomUUID()}`;
  const paper = { id: crypto.randomUUID(), title: "Local PDF", sourcePath: "/library/local.pdf" };
  const input = { scopeId, papers: [paper], enabled: true, importPdfs: vi.fn(async () => {}), openPaper: vi.fn(), onOpenReader: vi.fn() };
  const hook = renderHook((props) => useReadingLibraryController(props), { initialProps: input });
  const storage = createObjectStorage(scopeId, () => scopeId);
  return { ...hook, input, paper, storage, repository: createReadingLibraryRepository(storage, scopeId),
    info: { paperId: paper.id, sourcePath: paper.sourcePath, pageCount: 3 } };
}

test("marks a local PDF only after document load, and repeated info does not rewrite metadata", async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.pending).toBe(false));
  act(() => f.result.current.open(f.result.current.entries[0]));
  expect(f.input.openPaper).toHaveBeenCalledWith(f.paper.id);
  expect((await f.repository.metadata())[f.paper.id]).toBeUndefined();
  await act(async () => { await Promise.all([f.result.current.recordPdfOpened(f.info), f.result.current.recordPdfOpened({ ...f.info, size: 20 })]); });
  expect(f.result.current.entries[0].readingStatus).toBe("reading");
  const first = await f.storage.get(`reading-library/metadata/${f.paper.id}`);
  await act(async () => { await f.result.current.recordPdfOpened(f.info); });
  expect(await f.storage.get(`reading-library/metadata/${f.paper.id}`)).toEqual(first);
  f.unmount();
});

test("preserves finished from latest stored metadata and legacy paper metadata", async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.pending).toBe(false));
  await f.repository.updateMetadata(f.paper.id, { readingStatus: "finished" });
  await act(async () => { await f.result.current.recordPdfOpened(f.info); });
  expect((await f.repository.metadata())[f.paper.id].readingStatus).toBe("finished");
  expect(f.result.current.entries[0].readingStatus).toBe("finished");
  f.unmount();

  const legacy = setup();
  await savePaperFileMetadata(legacy.paper.id, { category: "", tags: [], readingStatus: "finished" });
  await act(async () => { await legacy.result.current.recordPdfOpened(legacy.info); });
  expect(legacy.result.current.entries[0].readingStatus).toBe("finished");
  expect((await legacy.repository.metadata())[legacy.paper.id]).toBeUndefined();
  legacy.unmount();
});

test("ignores missing, stale-source, cloud and old-account PDF callbacks", async () => {
  const f = setup();
  await act(async () => {
    await f.result.current.recordPdfOpened({ ...f.info, paperId: "cloud-paper" });
    await f.result.current.recordPdfOpened({ ...f.info, sourcePath: "/old/source.pdf" });
    await f.result.current.recordPdfOpened({ ...f.info, pageCount: 0 });
  });
  expect(await f.repository.metadata()).toEqual({});
  f.rerender({ ...f.input, papers: [{ ...f.paper, sourcePath: "org://team/document" }] });
  await act(async () => { await f.result.current.recordPdfOpened({ ...f.info, sourcePath: "org://team/document" }); });
  expect(await f.repository.metadata()).toEqual({});
  const oldAccountCallback = f.result.current.recordPdfOpened;
  const nextScope = `${f.input.scopeId}-other`;
  f.rerender({ ...f.input, scopeId: nextScope });
  await act(async () => { await oldAccountCallback(f.info); });
  expect(await f.repository.metadata()).toEqual({});
  expect(await createReadingLibraryRepository(createObjectStorage(nextScope, () => nextScope), nextScope).metadata()).toEqual({});
  f.unmount();
});

test("a concurrent finished update wins over a PDF load status write", async () => {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const ordinary = createReadingLibraryRepository(storage, scope);
  let race = true;
  const repository = createReadingLibraryRepository({ ...storage, commit: async (changes) => {
    if (race) { race = false; await ordinary.updateMetadata("paper", { readingStatus: "finished", tags: ["keep"] }); }
    return storage.commit(changes);
  } }, scope);
  expect(await repository.markReading("paper")).toMatchObject({ readingStatus: "finished", tags: ["keep"] });
  expect((await ordinary.metadata()).paper).toMatchObject({ readingStatus: "finished", tags: ["keep"] });
});
