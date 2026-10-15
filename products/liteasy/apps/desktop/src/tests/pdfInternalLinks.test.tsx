import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfInternalLinks } from "../app/features/pdf/PdfInternalLinks";

vi.mock("../app/features/pdf/PdfSourcePreview", () => ({ default: ({ source, pdfDocument }: any) =>
  <div className="source-pdf-preview" aria-label="原始 PDF 预览">{JSON.stringify({ page: source.page, topRatio: source.target.topRatio, shared: Boolean(pdfDocument) })}</div> }));

function documentMock(overrides = {}) {
  return { numPages: 4, fingerprints: ["links"], getDestination: vi.fn().mockResolvedValue([{ num: 7, gen: 0 }, { name: "XYZ" }, 20, 450, null]),
    getPageIndex: vi.fn().mockResolvedValue(2), getPage: vi.fn().mockResolvedValue({ view: [0, 0, 400, 600],
      getAnnotations: vi.fn().mockResolvedValue([
        { id: "chapter", subtype: "Link", dest: "chapter", rect: [20, 400, 120, 430] },
        { id: "external", subtype: "Link", url: "https://example.com", rect: [20, 300, 120, 330] },
        { id: "invalid", subtype: "Link", dest: [9], rect: [0, NaN, 1, 2] },
      ]),
      getViewport: () => ({ width: 400, height: 600, convertToViewportPoint: (x: number, y: number) => [x, 600 - y],
        convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1, 600 - y1, x2, 600 - y2] }),
    }), ...overrides } as unknown as PDFDocumentProxy;
}

test("PDF annotation links preview on hover and navigate to the resolved location on click", async () => {
  const document = documentMock(), onNavigate = vi.fn();
  render(<PdfInternalLinks document={document} pageNumber={1} onNavigate={onNavigate} />);
  const link = await screen.findByRole("link", { name: "跳转到 PDF 内部位置" });
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(link.parentElement).toHaveStyle({ left: "5%", width: "25%", height: "5%" });
  expect(document.getDestination).not.toHaveBeenCalled();
  fireEvent.mouseEnter(link);
  expect(await screen.findByLabelText("原始 PDF 预览")).toHaveTextContent('{"page":3,"topRatio":0.25,"shared":true}');
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(link);
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ page: 3, topRatio: .25 }));
  expect(screen.queryByLabelText("原始 PDF 预览")).not.toBeInTheDocument();
});

test("ignores a pending destination when its document is replaced", async () => {
  let resolve!: (value: unknown) => void;
  const first = documentMock({ getDestination: () => new Promise(done => { resolve = done; }) });
  const onNavigate = vi.fn();
  const { rerender } = render(<PdfInternalLinks document={first} pageNumber={1} onNavigate={onNavigate} />);
  fireEvent.click(await screen.findByRole("link"));
  await waitFor(() => expect(resolve).toBeDefined());
  rerender(<PdfInternalLinks document={documentMock()} pageNumber={1} onNavigate={onNavigate} />);
  await act(async () => resolve([0, { name: "Fit" }]));
  expect(onNavigate).not.toHaveBeenCalled();
});

test("broken destinations show feedback without navigating", async () => {
  const onNavigate = vi.fn();
  render(<PdfInternalLinks document={documentMock({ getDestination: vi.fn().mockResolvedValue(null) })} pageNumber={1} onNavigate={onNavigate} />);
  fireEvent.click(await screen.findByRole("link"));
  expect(await screen.findByRole("status")).toHaveTextContent(/位置/);
  expect(onNavigate).not.toHaveBeenCalled();
});
