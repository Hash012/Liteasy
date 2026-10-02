import { act, renderHook } from "@testing-library/react";
import { strToU8, zipSync } from "fflate";
import { expect, test, vi } from "vitest";
import { useReadingLibraryController } from "../app/controllers/useReadingLibraryController";
import type { OriginalFileDescriptor } from "../app/features/original-files/originalFileService";

const storage = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(async () => []), commit: vi.fn() }));
vi.mock("../app/features/objects/objectStorage", () => ({
  createObjectStorage: () => storage, subscribeObjectStorage: () => () => undefined
}));

test("parses an original EPUB into the existing reader without storing the body or a library entry", async () => {
  const bytes = zipSync(Object.fromEntries(Object.entries({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf" /></rootfiles></container>',
    "book.opf": '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Synthetic manual</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="one" /></spine></package>',
    "one.xhtml": '<html><body><h1>Manual</h1><p>Read at the original location.</p></body></html>'
  }).map(([name, text]) => [name, strToU8(text)])));
  const originalBytes = bytes.slice();
  const file: OriginalFileDescriptor = { id: "epub-grant", path: "/synthetic/manual.epub", fileName: "manual.epub", format: "epub", sizeBytes: bytes.length, modifiedUnixMs: 1000 };
  const onOpenReader = vi.fn();
  const h = renderHook(() => useReadingLibraryController({
    scopeId: "local", papers: [], enabled: false, importPdfs: vi.fn(), openPaper: vi.fn(), onOpenReader
  }));
  await act(async () => { await h.result.current.openOriginalFile(file, bytes); });
  const first = h.result.current.active;
  expect(first?.document.title).toBe("Synthetic manual");
  expect(first?.document.chapters[0].plainText).toContain("original location");
  expect(h.result.current.entries).toEqual([]);
  expect(h.result.current.selected).toMatchObject({ physicalPath: file.path, canRemove: false, canExport: false });
  expect(storage.commit).not.toHaveBeenCalled();
  expect(bytes).toEqual(originalBytes);
  act(() => h.result.current.closeReader());
  await act(async () => { await h.result.current.openOriginalFile({ ...file, id: "next-grant" }, bytes); });
  expect(h.result.current.active?.id).toBe(first?.id);
  expect(onOpenReader).toHaveBeenCalledTimes(2);
});
