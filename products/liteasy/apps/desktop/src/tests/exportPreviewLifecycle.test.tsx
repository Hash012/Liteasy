import userEvent from "@testing-library/user-event";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ArtifactExportPayload } from "../app/features/artifacts/artifactExport.types";
import { compileDocument } from "../app/features/document-export/documentCompiler";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument, TextLayer: class { container: HTMLElement; text: { items: Array<{ str: string }> }; constructor({ container, textContentSource }: any) { this.container = container; this.text = textContentSource; } async render() { this.container.textContent = this.text.items.map(item => item.str).join(" "); } cancel() {} } }));
import { ExportPdfPreview } from "../app/features/document-export/ExportPdfPreview";
import { DocumentExportDialog } from "../app/features/document-export/DocumentExportDialog";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const payload = (marker: string): ArtifactExportPayload => ({ artifactId: marker, title: marker, format: "pdf", fileName: `${marker}.pdf`, content: btoa(marker), contentEncoding: "base64" });
function documentMock(marker: string) {
  const renderPage = vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => { canvas.dataset.paintedDocument = marker; return { promise: Promise.resolve(), cancel: vi.fn() }; });
  return { numPages: 10, destroy: vi.fn(), getPage: vi.fn(async (_page: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: renderPage, cleanup: vi.fn(), getTextContent: async () => ({ items: [{ str: marker }], styles: {} }) })), renderPage };
}
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))); vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 700)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("export production component lifecycle", () => {
  test("repaints B after ready when A and B have identical page counts and selected page", async () => {
    const first = deferred<ReturnType<typeof documentMock>>(), second = deferred<ReturnType<typeof documentMock>>();
    pdf.getDocument.mockReturnValueOnce({ promise: first.promise, destroy: vi.fn() }).mockReturnValueOnce({ promise: second.promise, destroy: vi.fn() });
    const a = documentMock("A_MARKER"), b = documentMock("B_MARKER");
    const view = render(<ExportPdfPreview payload={payload("A")} />);
    await act(async () => first.resolve(a));
    await waitFor(() => expect(view.container.querySelector("canvas")?.dataset.paintedDocument).toBe("A_MARKER"));
    view.rerender(<ExportPdfPreview payload={payload("B")} />);
    await act(async () => second.resolve(b));
    await waitFor(() => expect(view.container.querySelector("canvas")?.dataset.paintedDocument).toBe("B_MARKER"));
  });
  test("awaits render cancellation before reusing a canvas during rapid page changes", async () => {
    const old = deferred<void>(), a = documentMock("SERIAL"), events: string[] = [];
    a.getPage.mockImplementation(async (page: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), cleanup: vi.fn(), getTextContent: async () => ({ items: [{ str: `PAGE_${page}` }], styles: {} }), render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
      events.push(`start:${page}`); canvas.dataset.paintedDocument = `PAGE_${page}`;
      return { promise: page === 1 ? old.promise : Promise.resolve(), cancel: () => { events.push(`cancel:${page}`); } };
    } }) as any);
    pdf.getDocument.mockReturnValue({ promise: Promise.resolve(a), destroy: vi.fn() });
    render(<ExportPdfPreview payload={payload("SERIAL")} />);
    await waitFor(() => expect(events).toEqual(["start:1"]));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await act(async () => undefined);
    expect(events).toEqual(["start:1", "cancel:1"]);
    await act(async () => old.resolve());
    await waitFor(() => expect(screen.getByLabelText("第 2 页文字")).toHaveTextContent("PAGE_2"));
    expect(events).toEqual(["start:1", "cancel:1", "start:2"]);
  });
  test("slow old document loading cannot replace a ready newer document", async () => {
    const old = deferred<ReturnType<typeof documentMock>>(), a = documentMock("LATE_A"), b = documentMock("CURRENT_B");
    pdf.getDocument.mockReturnValueOnce({ promise: old.promise, destroy: vi.fn() }).mockReturnValueOnce({ promise: Promise.resolve(b), destroy: vi.fn() });
    const view = render(<ExportPdfPreview payload={payload("A")} />);
    view.rerender(<ExportPdfPreview payload={payload("B")} />);
    await waitFor(() => expect(screen.getByLabelText("第 1 页文字")).toHaveTextContent("CURRENT_B"));
    await act(async () => old.resolve(a));
    expect(screen.getByLabelText("第 1 页文字")).toHaveTextContent("CURRENT_B");
  });
  test("closing an actual mounted dialog detaches and reopening restores the same scoped frozen job", async () => {
    const a = await compileDocument({ title: "Retained", markdown: "RETAINED_BODY" });
    const pending = deferred<typeof a>(), compile = vi.fn((_options: unknown, _signal: AbortSignal) => pending.promise);
    const props = { title: "Retained", jobScope: `scope:${crypto.randomUUID()}`, sourceIdentity: "note:1@v1", initialFormat: "markdown" as const, compile, publish: vi.fn(async () => ({ status: "cancelled" as const })), onClose: vi.fn(), onOutcome: vi.fn(), open: true };
    const first = render(<DocumentExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    const signal = compile.mock.calls[0][1] as AbortSignal;
    first.unmount(); expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve(a));
    render(<DocumentExportDialog {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存本次文档" })).not.toBeDisabled());
    expect(screen.getByTitle("导出文档结构预览").getAttribute("srcdoc")).toContain("RETAINED_BODY");
    expect(compile).toHaveBeenCalledTimes(1);
  });
  test("late save receipt for A does not close or acknowledge the B view", async () => {
    const a = await compileDocument({ title: "A", markdown: "A_BODY" });
    const pending = deferred<{ status: "cancelled" }>();
    const shared = { initialFormat: "markdown" as const, compile: vi.fn(async () => a), publish: vi.fn(() => pending.promise), onClose: vi.fn(), onOutcome: vi.fn(), open: true };
    const view = render(<DocumentExportDialog {...shared} title="A" />);
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存本次文档" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "保存本次文档" }));
    await waitFor(() => expect(shared.publish).toHaveBeenCalledTimes(1));
    view.rerender(<DocumentExportDialog {...shared} title="B" />);
    await act(async () => pending.resolve({ status: "cancelled" }));
    expect(shared.onClose).not.toHaveBeenCalled(); expect(shared.onOutcome).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存本次文档" })).toBeDisabled();
  });
  test("a broken PDF clears its error when replaced with a selectable normal page", async () => {
    const destroy = vi.fn();
    pdf.getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error("bad pdf")), destroy }).mockReturnValueOnce({ promise: Promise.resolve(documentMock("RECOVERED")), destroy: vi.fn() });
    const view = render(<ExportPdfPreview payload={payload("INVALID")} />);
    await screen.findByRole("alert");
    view.rerender(<ExportPdfPreview payload={payload("VALID")} />);
    await waitFor(() => expect(screen.getByLabelText("第 1 页文字")).toHaveTextContent("RECOVERED"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
  });
  test("option changes invalidate the accepted preview and browser PDF remains an explicit structure preview", async () => {
    const doc = await compileDocument({ title: "PDF", markdown: "BODY" });
    const props = { title: "PDF", initialFormat: "pdf" as const, compile: vi.fn(async () => doc), publish: vi.fn(async () => ({ status: "cancelled" as const })), onClose: vi.fn(), onOutcome: vi.fn(), open: true };
    render(<DocumentExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("文档结构预览；尚未生成可核验 PDF，保存由系统打印管理。");
    expect(screen.queryByLabelText("本次实际生成的 PDF 页面")).not.toBeInTheDocument();
    const print = vi.spyOn((screen.getByTitle("导出文档结构预览") as HTMLIFrameElement).contentWindow!, "print").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "系统打印" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1)); expect(props.publish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("combobox", { name: "证据篇幅" }));
    await userEvent.click(screen.getByRole("option", { name: "来源索引" }));
    expect(screen.queryByTitle("导出文档结构预览")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "系统打印" })).toBeDisabled();
  });
  test("accepted degradation never authorizes a new source/options job", async () => {
    const doc = await compileDocument({ title: "Warning", markdown: "![Missing](missing.png)" });
    render(<DocumentExportDialog title="Warning" initialFormat="markdown" open compile={async () => doc} publish={async () => ({ status: "cancelled" })} onClose={() => undefined} onOutcome={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    const acceptance = await screen.findByRole("checkbox", { name: "我已了解缺失资源与格式降级，继续导出" });
    fireEvent.click(acceptance); fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存本次文档" })).not.toBeDisabled());
    await userEvent.click(screen.getByRole("combobox", { name: "证据篇幅" }));
    await userEvent.click(screen.getByRole("option", { name: "来源索引" }));
    expect(screen.getByRole("button", { name: "保存本次文档" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "我已了解缺失资源与格式降级，继续导出" })).not.toBeChecked());
    expect(screen.getByRole("button", { name: "保存本次文档" })).toBeDisabled();
  });
  test("late compile A cannot populate or publish reopened source B", async () => {
    const a = await compileDocument({ title: "A", markdown: "SOURCE_A_BODY" });
    const b = await compileDocument({ title: "B", markdown: "SOURCE_B_BODY" });
    const pending = deferred<typeof a>();
    const publish = vi.fn(async () => ({ status: "cancelled" as const }));
    const shared = { initialFormat: "markdown" as const, publish, onClose: vi.fn(), onOutcome: vi.fn() };
    const compileA = vi.fn(() => pending.promise), compileB = vi.fn(async () => b);
    const view = render(<DocumentExportDialog {...shared} title="A" open compile={compileA} />);
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    view.rerender(<DocumentExportDialog {...shared} title="A" open={false} compile={compileA} />);
    view.rerender(<DocumentExportDialog {...shared} title="B" open compile={compileB} />);
    await act(async () => pending.resolve(a));
    const frame = screen.queryByTitle("导出文档结构预览");
    expect(frame?.getAttribute("srcdoc") ?? "").not.toContain("SOURCE_A_BODY");
    expect(screen.getByRole("button", { name: "保存本次文档" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(screen.getByTitle("导出文档结构预览").getAttribute("srcdoc")).toContain("SOURCE_B_BODY"));
  });
});

test("format, paper and orientation pickers feed the exact options into the next export job", async () => {
  const compile = vi.fn((options: Parameters<typeof compileDocument>[0]["options"], signal: AbortSignal) => compileDocument({ title: "Scoped options", markdown: "Kept original document text", options, signal }));
  const publish = vi.fn(async (_payload: ArtifactExportPayload, _signal?: AbortSignal) => ({ status: "cancelled" as const }));
  render(<DocumentExportDialog title="Scoped options" initialFormat="markdown" open allowSpatial compile={compile} publish={publish} onClose={() => undefined} onOutcome={() => undefined} />);
  const user = userEvent.setup();
  for (const [field, label] of [["格式", "HTML"], ["版式", "空间图集（PDF/HTML）"], ["纸张", "A3"], ["方向", "横向纸张"]]) {
    await user.click(screen.getByRole("combobox", { name: field, exact: true }));
    await user.click(screen.getByRole("option", { name: label, exact: true }));
  }
  expect(compile).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "生成预览" }));
  await waitFor(() => expect(compile).toHaveBeenCalledWith(expect.objectContaining({ paperSize: "A3", orientation: "landscape", profileId: "spatial-atlas/v1" }), expect.any(AbortSignal)));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存本次文档" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "保存本次文档" }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith(expect.objectContaining({ format: "html", contentEncoding: "base64", receipt: expect.objectContaining({ profileId: "spatial-atlas/v1" }) }), expect.any(AbortSignal)));
  expect(atob(publish.mock.calls[0][0].content)).toContain("Kept original document text");
});
