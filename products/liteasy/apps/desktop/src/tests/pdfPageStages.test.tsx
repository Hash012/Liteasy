import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfPageView } from "../app/features/pdf/PdfReader";
const mocks = vi.hoisted(() => ({ glyphs: vi.fn(), model: vi.fn(), text: vi.fn() }));
vi.mock("../app/features/pdf/pdfGlyphGeometry", () => ({ loadPdfGlyphGeometry: mocks.glyphs, releasePdfGlyphGeometry: vi.fn() }));
vi.mock("../app/features/pdf/pdfSelectionEngine", async original => ({ ...await original<object>(), buildPageCharModelFromTextLayer: mocks.model }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async original => ({ ...await original<object>(), TextLayer: class { constructor(private input: { container: HTMLElement }) {} async render() { mocks.text(); this.input.container.textContent = "Native PDF text"; } cancel() {} } }));
beforeEach(() => {
  mocks.glyphs.mockReset(); mocks.text.mockReset(); mocks.model.mockReset().mockReturnValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect() {}, fillRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} } as never);
});
afterEach(() => vi.restoreAllMocks());
function mount() {
  const onText = vi.fn();
  const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 400 * scale, height: 600 * scale, scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: async () => ({ items: [{ str: "Native PDF text" }] }), cleanup() {} };
  const document = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const view = render(<PdfPageView activePaper={{ id: "p", title: "P" }} annotations={[]} focused layoutVisible pageNumber={1} renderActive defaultPageSize={{ width: 400, height: 600 }} pixelRatio={1} readingBackground="#ffffff" preserveImages pdfDocument={document} stageWidth={400} zoom={100} onPageTextRendered={onText} />);
  return { ...view, onText };
}
test("native text and its selection model become ready while optional glyph extraction hangs", async () => {
  mocks.glyphs.mockReturnValue(new Promise(() => {})); const { container, onText } = mount();
  await waitFor(() => expect(onText).toHaveBeenCalledWith({ page: 1, text: "Native PDF text" }));
  expect(container.querySelector(".textLayer")).toHaveTextContent("Native PDF text");
  expect(mocks.model).toHaveBeenCalledWith(expect.objectContaining({ glyphs: [] }));
  expect(container.querySelector("canvas")!.width).toBeGreaterThan(0);
});
test("glyph rejection and text-layer failure preserve a rendered page", async () => {
  mocks.glyphs.mockRejectedValue(new Error("operator failure")); const first = mount();
  await waitFor(() => expect(first.onText).toHaveBeenCalled()); expect(first.container.querySelector("canvas")!.width).toBeGreaterThan(0); first.unmount();
  mocks.text.mockImplementation(() => { throw new Error("font failure"); }); const second = mount();
  await screen.findByText(/本页文字层暂不可用/); expect(second.container.querySelector("canvas")!.width).toBeGreaterThan(0);
});
test("late glyph refinement waits until the pointer selection finishes", async () => {
  let finish!: (value: unknown[]) => void; mocks.glyphs.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const view = mount();
  await waitFor(() => expect(view.onText).toHaveBeenCalled()); const before = mocks.model.mock.calls.length;
  fireEvent.pointerDown(screen.getByLabelText("PDF.js 页面 1"));
  await act(async () => { finish([{ text: "Native" }]); }); expect(mocks.model).toHaveBeenCalledTimes(before);
  fireEvent.pointerUp(window); await waitFor(() => expect(mocks.model).toHaveBeenCalledTimes(before + 1));
});
