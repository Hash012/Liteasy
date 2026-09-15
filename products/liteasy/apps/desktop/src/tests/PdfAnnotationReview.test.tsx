import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { ObjectWorkbenchContext, type ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import {
  loadPdfAnnotations,
  pdfAnnotationStorageKey,
  recoverPdfAnnotationPrivateState,
  savePdfAnnotations,
  type PdfAnnotationV2,
} from "../app/features/pdf/pdfAnnotationStorage";
import { preparePdfAnnotationCapture } from "../app/features/pdf/pdfAnnotationCapture";

const paper = { id: "entry-review-paper", title: "Review paper", sourcePath: "/papers/review.pdf" };
function entry(): PdfAnnotationV2 {
  return {
    id: "entry", kind: "highlight", page: 1, revision: 1,
    paperIdentity: resolvePaperIdentity(paper),
    excerpt: "Original source passage", note: "用户自己的理解", text: "高亮",
    rects: [{ left: 10, top: 20, width: 30, height: 2 }],
    createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z",
    publication: { desiredVisibility: "private", state: "not_published" },
  };
}
function workbench(overrides: Partial<ObjectWorkbenchPort> = {}): ObjectWorkbenchPort {
  return {
    capturePdf: vi.fn(async () => []), captureMessage: vi.fn(async () => []), dragPdf: vi.fn(),
    dragMessage: vi.fn(), explain: vi.fn(), openLegacyBoard: vi.fn(async () => {}), open: vi.fn(),
    reviewAnnotation: vi.fn(async () => "请补充对照实验，区分观察与推断。"), ...overrides,
  };
}
function reader(port: ObjectWorkbenchPort, selected = paper) {
  return <ObjectWorkbenchContext.Provider value={port}>
    <PdfReader selectedPapers={[selected]} zoom={100} />
  </ObjectWorkbenchContext.Provider>;
}
async function openEntry() {
  fireEvent.click(await screen.findByRole("button", { name: "编辑批注：Original source passage" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "AI review：Original source passage" })).toBeEnabled());
}
function stored() {
  return loadPdfAnnotations(pdfAnnotationStorageKey(paper), resolvePaperIdentity(paper))[0] as PdfAnnotationV2;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

test("review is saved in the entry, reloads, remains editable, and travels with its source in captures", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [entry()]);
  const port = workbench();
  const view = render(reader(port));
  await openEntry();
  fireEvent.click(screen.getByRole("button", { name: "AI review：Original source passage" }));
  await screen.findByText("AI review 已随批注保存。");
  expect(port.reviewAnnotation).toHaveBeenCalledWith(expect.objectContaining({
    paper, annotation: expect.objectContaining({ note: "用户自己的理解", excerpt: "Original source passage" }),
  }), expect.any(AbortSignal));
  expect(stored()).toMatchObject({ note: "用户自己的理解", excerpt: "Original source passage", revision: 2,
    review: { text: "请补充对照实验，区分观察与推断。", sourceRevision: 1 } });

  view.unmount();
  render(reader(port));
  await openEntry();
  const review = screen.getByRole("region", { name: "AI review" });
  expect(within(review).getByText("请补充对照实验，区分观察与推断。")).toBeVisible();
  fireEvent.click(within(review).getByRole("button", { name: "编辑 AI review" }));
  fireEvent.change(within(review).getByRole("textbox", { name: "AI review 内容" }), { target: { value: "已修改的 review，保留引用。" } });
  fireEvent.click(within(review).getByRole("button", { name: "保存 AI review" }));
  await waitFor(() => expect(stored().review?.text).toBe("已修改的 review，保留引用。"));
  const capture = await preparePdfAnnotationCapture({ paper, annotation: stored() });
  expect(capture.quote).toBe("Original source passage");
  expect(capture.text).toBe("用户自己的理解\n\n## AI review\n\n已修改的 review，保留引用。");
  expect(stored().publication).toEqual(entry().publication);
});

test("an edited entry cannot be overwritten by an in-flight review; its result can be checked and saved", async () => {
  let finish!: (value: string) => void;
  const port = workbench({ reviewAnnotation: vi.fn(() => new Promise<string>((resolve) => { finish = resolve; })) });
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [entry()]);
  render(reader(port));
  await openEntry();
  fireEvent.click(screen.getByRole("button", { name: "AI review：Original source passage" }));
  fireEvent.change(screen.getByRole("textbox", { name: "补充批注笔记" }), { target: { value: "用户在 review 期间修改了批注" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await act(async () => finish("基于旧版本的 review"));
  await openEntry();
  expect(await screen.findByRole("alert")).toHaveTextContent("批注已更改");
  expect(stored().note).toBe("用户在 review 期间修改了批注");
  expect(stored().review).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "核对并保存 review" }));
  fireEvent.click(screen.getByRole("button", { name: "保存 AI review" }));
  await waitFor(() => expect(stored().review?.text).toBe("基于旧版本的 review"));
  expect(stored().note).toBe("用户在 review 期间修改了批注");
  expect(stored().review?.sourceRevision).toBe(1);
});

test("switching papers cancels review and a late answer cannot change either entry", async () => {
  let finish!: (value: string) => void;
  const request = vi.fn((_input, _signal: AbortSignal) => new Promise<string>((resolve) => { finish = resolve; }));
  const port = workbench({ reviewAnnotation: request });
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [entry()]);
  const view = render(reader(port));
  await openEntry();
  fireEvent.click(screen.getByRole("button", { name: "AI review：Original source passage" }));
  view.rerender(reader(port, { ...paper, id: "other-paper" }));
  expect(request.mock.calls[0][1].aborted).toBe(true);
  await act(async () => finish("late answer"));
  expect(stored().review).toBeUndefined();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey({ ...paper, id: "other-paper" }))).toEqual([]);
});

test("failed regeneration preserves a previously edited review and shows the request error", async () => {
  const item = entry();
  item.review = { text: "用户保留的 review", sourceRevision: 1, generatedAt: item.createdAt, updatedAt: item.updatedAt };
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item]);
  render(reader(workbench({ reviewAnnotation: vi.fn(async () => { throw new Error("AI 服务离线"); }) })));
  await openEntry();
  fireEvent.click(screen.getByRole("button", { name: "AI review：Original source passage" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 服务离线");
  expect(screen.getByText("用户保留的 review")).toBeVisible();
  expect(stored().review?.text).toBe("用户保留的 review");
});

test("storage failure retains generated text for retry without claiming it was saved", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [entry()]);
  render(reader(workbench()));
  await openEntry();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("磁盘空间不足"); });
  fireEvent.click(screen.getByRole("button", { name: "AI review：Original source passage" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘空间不足");
  expect(screen.getByText("请补充对照实验，区分观察与推断。")).toBeVisible();
  expect(screen.queryByText("AI review 已随批注保存。")).not.toBeInTheDocument();
  expect(stored().review).toBeUndefined();
});

test("corrupt optional review metadata never discards the user's annotation", () => {
  const result = recoverPdfAnnotationPrivateState({ annotations: [{ ...entry(), review: { text: "damaged" } }], version: 2 });
  expect(result.annotations).toHaveLength(1);
  expect(result.annotations[0].note).toBe("用户自己的理解");
  expect(result.annotations[0].review).toBeUndefined();
  expect(result.issues).toEqual([{ annotationId: "entry", message: "AI review 数据损坏；用户批注已保留。" }]);
});
