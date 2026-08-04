import { afterEach, expect, test, vi } from "vitest";

import { openExternalPdfInBrowser } from "../app/features/library/externalPdfDownload";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("opens server-verified PDF bytes in a browser tab", async () => {
  vi.useFakeTimers();
  const replace = vi.fn();
  const close = vi.fn();
  const readerWindow = {
    close,
    document: { title: "" },
    location: { replace }
  } as unknown as Window;
  vi.spyOn(window, "open").mockReturnValue(readerWindow);
  const createObjectURL = vi.fn(() => "blob:verified-paper");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nverified");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    byteLength: pdfBytes.byteLength,
    bytesBase64: btoa(String.fromCharCode(...pdfBytes)),
    contentHash: "a".repeat(64),
    contentType: "application/pdf",
    finalUrl: "https://papers.example.test/paper.pdf",
    sourceId: "paper-1"
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  })));

  await openExternalPdfInBrowser({
    endpoint: "http://127.0.0.1:8787/",
    source: {
      id: "paper-1",
      title: "Verified paper",
      url: "https://papers.example.test/record",
      fullTextUrl: "https://papers.example.test/paper.pdf"
    }
  });

  expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(readerWindow.document.title).toBe("正在获取《Verified paper》");
  expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:8787/v1/research/external-pdf",
    expect.objectContaining({ method: "POST" })
  );
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledWith("blob:verified-paper");
  expect(close).not.toHaveBeenCalled();

  vi.advanceTimersByTime(10 * 60 * 1000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:verified-paper");
});

test("closes the pending browser tab when PDF retrieval fails", async () => {
  const close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({
    close,
    document: { title: "" },
    location: { replace: vi.fn() }
  } as unknown as Window);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unavailable", { status: 502 })));

  await expect(openExternalPdfInBrowser({
    endpoint: "http://127.0.0.1:8787",
    source: {
      id: "paper-2",
      title: "Unavailable paper",
      url: "https://papers.example.test/record",
      fullTextUrl: "https://papers.example.test/paper.pdf"
    }
  })).rejects.toThrow("502");

  expect(close).toHaveBeenCalledOnce();
});
