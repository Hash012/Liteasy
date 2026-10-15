import { act, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfPage } from "../app/features/pdf/PdfPage";
import type { PDFDocumentProxy } from "../app/features/pdf/pdfEngine";

vi.mock("../app/features/pdf/pdfEngine", () => ({
  canvasOutput: (width: number, height: number) => ({ width, height, ratio: 1 }),
  pdfjs: { AnnotationMode: { DISABLE: 0 }, TextLayer: class { render() { return Promise.resolve(); } cancel() {} } }
}));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const jobs: Array<{ resolve(): void; promise: Promise<void> }> = [];
  const document = { getPage: vi.fn(async (pageNumber: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 400 * scale, height: 600 * scale, scale }),
    getTextContent: async () => ({ items: [{ str: `Page ${pageNumber}` }] }), cleanup: vi.fn(),
    render: () => {
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      jobs.push({ promise, resolve });
      return { promise, cancel: vi.fn() };
    }
  })) } as unknown as PDFDocumentProxy;
  const commits: Array<{ page: number; zoom: number; busy: string | null }> = [];
  function View({ page, zoom }: { page: number; zoom: number }) {
    // Observe the committed DOM before passive effects start the new PDF request.
    useLayoutEffect(() => { commits.push({ page, zoom, busy: window.document.querySelector(".pdf-page")!.getAttribute("aria-busy") }); }, [page, zoom]);
    return <PdfPage document={document} pageNumber={page} zoom={zoom} />;
  }
  return { document, jobs, commits, View };
}

test("new pages and zooms cannot borrow readiness from the previous rendered request", async () => {
  const f = fixture();
  const view = render(<f.View page={1} zoom={1} />);
  await waitFor(() => expect(f.jobs).toHaveLength(1));
  await act(async () => f.jobs[0].resolve());
  expect(document.querySelector(".pdf-page")).toHaveAttribute("aria-busy", "false");

  view.rerender(<f.View page={2} zoom={1} />);
  expect(f.commits.at(-1)).toEqual({ page: 2, zoom: 1, busy: "true" });
  await waitFor(() => expect(f.jobs).toHaveLength(2));
  await act(async () => f.jobs[1].resolve());
  expect(document.querySelector(".pdf-page")).toHaveAttribute("aria-busy", "false");

  view.rerender(<f.View page={2} zoom={1.25} />);
  expect(f.commits.at(-1)).toEqual({ page: 2, zoom: 1.25, busy: "true" });
  await waitFor(() => expect(f.jobs).toHaveLength(3));
  view.rerender(<f.View page={3} zoom={1.25} />);
  await waitFor(() => expect(f.jobs).toHaveLength(4));
  await act(async () => f.jobs[2].resolve());
  expect(document.querySelector(".pdf-page")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("正在显示第 3 页");
  await act(async () => f.jobs[3].resolve());
  expect(document.querySelector(".pdf-page")).toHaveAttribute("aria-busy", "false");
  expect(document.querySelectorAll("canvas")).toHaveLength(1);
});
