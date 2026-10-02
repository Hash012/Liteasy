import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PdfThumbnail } from "../app/features/pdf/PdfThumbnail";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function page() {
  return {
    cleanup: vi.fn(() => true),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale })),
    render: vi.fn(() => ({ cancel: vi.fn(), promise: Promise.resolve() })),
  };
}
function setup() {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
}

test("unmount releases completed thumbnail page resources and backing canvas", async () => {
  setup();
  const proxy = page();
  const document = { getPage: vi.fn().mockResolvedValue(proxy) } as unknown as PDFDocumentProxy;
  const view = render(<PdfThumbnail active={false} annotations={[]} onNavigate={vi.fn()} pageNumber={1} pdfDocument={document} />);
  await waitFor(() => expect(proxy.render).toHaveBeenCalledOnce());
  const canvas = view.container.querySelector("canvas")!;
  expect(canvas.width).toBeGreaterThan(1);
  view.unmount();
  expect(proxy.cleanup).toHaveBeenCalled();
  expect(canvas.width * canvas.height).toBe(1);
});

test("a page resolving after cancellation is cleaned without rendering or state updates", async () => {
  setup();
  const pending = deferred<PDFPageProxy>();
  const proxy = page();
  const document = { getPage: vi.fn().mockReturnValue(pending.promise) } as unknown as PDFDocumentProxy;
  const view = render(<PdfThumbnail active={false} annotations={[]} onNavigate={vi.fn()} pageNumber={1} pdfDocument={document} />);
  await waitFor(() => expect(document.getPage).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => { pending.resolve(proxy as unknown as PDFPageProxy); });
  expect(proxy.render).not.toHaveBeenCalled();
  expect(proxy.cleanup).toHaveBeenCalled();
});

test("50 mount/unmount cycles leave no unreturned thumbnail page leases", async () => {
  setup();
  const proxies = Array.from({ length: 50 }, page);
  const document = { getPage: vi.fn((index: number) => Promise.resolve(proxies[index - 1])) } as unknown as PDFDocumentProxy;
  for (let index = 0; index < proxies.length; index++) {
    const view = render(<PdfThumbnail active={false} annotations={[]} onNavigate={vi.fn()} pageNumber={index + 1} pdfDocument={document} />);
    await act(async () => {});
    view.unmount();
  }
  expect(proxies.filter((proxy) => proxy.render.mock.calls.length > 0)).toHaveLength(50);
  expect(proxies.filter((proxy) => proxy.cleanup.mock.calls.length === 0)).toHaveLength(0);
});
