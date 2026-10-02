import { expect, test, vi } from "vitest";
import { buildOriginalReaderPaper, createOriginalFileService, type OriginalFileDescriptor } from "../app/features/original-files/originalFileService";
import { pdfAnnotationStorageKey } from "../app/features/pdf/pdfAnnotationStorage";

export const originalPdf: OriginalFileDescriptor = {
  id: "grant-manual", path: "/synthetic/manual.pdf", fileName: "manual.pdf", format: "pdf",
  sizeBytes: 15, modifiedUnixMs: 1000
};
const bytes = new TextEncoder().encode("%PDF-1.7\nmanual");

test("chooses an original and reads only its native grant without importing or sending the path back", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(originalPdf).mockResolvedValueOnce(bytes.slice().buffer);
  const service = createOriginalFileService("local", () => "local", invoke);
  expect(await service.choose()).toEqual(originalPdf);
  expect(Array.from(await service.read(originalPdf))).toEqual(Array.from(bytes));
  expect(invoke.mock.calls).toEqual([
    ["choose_native_open_file", { scope: "local" }],
    ["read_native_open_file", { scope: "local", id: "grant-manual" }]
  ]);
});

test("reopening unchanged bytes at the same original path keeps the paper and annotation identities", async () => {
  const first = await buildOriginalReaderPaper(originalPdf, bytes);
  const reopened = await buildOriginalReaderPaper({ ...originalPdf, id: "next-process-grant" }, bytes);
  expect(first.id).toMatch(/^paper-[a-f0-9]{64}$/);
  expect(reopened.id).toBe(first.id);
  expect(pdfAnnotationStorageKey(reopened)).toBe(pdfAnnotationStorageKey(first));
  expect(first.sourcePath).toBe(originalPdf.path);
  expect(first).not.toHaveProperty("cachePath");
  expect(bytes).toEqual(new TextEncoder().encode("%PDF-1.7\nmanual"));
});

test("scope changes during native read discard the response and prevent another request", async () => {
  let scope = "local";
  let complete!: (value: ArrayBuffer) => void;
  const invoke = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { complete = resolve; }));
  const service = createOriginalFileService("local", () => scope, invoke as never);
  const pending = service.read(originalPdf);
  scope = "user:other";
  complete(bytes.slice().buffer);
  await expect(pending).rejects.toThrow("账号已切换");
  await expect(service.read(originalPdf)).rejects.toThrow("账号已切换");
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("invalid PDF bytes never produce an original reader paper", async () => {
  await expect(buildOriginalReaderPaper(originalPdf, new TextEncoder().encode("not a PDF")))
    .rejects.toThrow("PDF");
});

test("releases a chooser result that arrives after an account switch", async () => {
  let scope = "local";
  let complete!: (file: OriginalFileDescriptor) => void;
  const invoke = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; })).mockResolvedValue(undefined);
  const service = createOriginalFileService("local", () => scope, invoke);
  const pending = service.choose();
  scope = "user:other";
  complete(originalPdf);
  await expect(pending).rejects.toThrow("账号已切换");
  expect(invoke).toHaveBeenLastCalledWith("release_native_open_file", { scope: "local", id: originalPdf.id });
});
