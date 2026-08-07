import { expect, test, vi } from "vitest";
import { loadPdfBytesForImport } from "../app/features/import/pdfSourceClient";

test("reads a browser-uploaded PDF directly from its blob URL", async () => {
  const fetchPdf = vi.fn().mockResolvedValue(new Response(
    new Uint8Array([37, 80, 68, 70, 45]),
    { status: 200 }
  ));
  const readTauriPdf = vi.fn();

  const bytes = await loadPdfBytesForImport({
    devCloudEndpoint: "http://127.0.0.1:8787",
    fetchPdf,
    readTauriPdf,
    sourcePath: "blob:http://127.0.0.1:1420/uploaded-paper",
    tauriAvailable: false
  });

  expect(fetchPdf).toHaveBeenCalledWith("blob:http://127.0.0.1:1420/uploaded-paper");
  expect(readTauriPdf).not.toHaveBeenCalled();
  expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
});

test("refuses local filesystem paths when the desktop host is unavailable", async () => {
  const fetchPdf = vi.fn().mockResolvedValue(new Response(
    new Uint8Array([37, 80, 68, 70, 45]),
    { status: 200 }
  ));
  const sourcePath = "/home/octopus/LiteasyLibrary/paper.pdf";

  await expect(loadPdfBytesForImport({
    devCloudEndpoint: "http://127.0.0.1:8787/",
    fetchPdf,
    readTauriPdf: vi.fn(),
    sourcePath,
    tauriAvailable: false
  })).rejects.toThrow("本地 PDF 只能由桌面宿主");
  expect(fetchPdf).not.toHaveBeenCalled();
});
