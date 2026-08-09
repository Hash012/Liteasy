import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import {
  collectPdfLiteratureHints,
  PdfReader
} from "../app/features/pdf/PdfReader";
import {
  pdfAnnotationStorageKey,
  savePdfAnnotations,
  type PdfAnnotationPublication,
  type PdfAnnotationV2
} from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { Paper } from "../app/features/workspace/workspace.types";

const paper: Paper = {
  doi: "10.1000/reader",
  id: "paper-publication",
  sourcePath: "/papers/publication.pdf",
  title: "Direct Annotation Publication"
};

function publicationAnnotation(
  publication: PdfAnnotationPublication = {
    desiredVisibility: "private",
    state: "not_published"
  }
): PdfAnnotationV2 {
  return {
    createdAt: "2026-08-10T00:00:00.000Z",
    excerpt: "Publication evidence",
    id: "annotation-1",
    kind: "note",
    note: "Initial note",
    page: 1,
    paperIdentity: resolvePaperIdentity(paper),
    publication,
    rects: [{ height: 2, left: 20, top: 20, width: 30 }],
    revision: 1,
    text: "注释",
    updatedAt: "2026-08-10T00:00:00.000Z"
  };
}

function renderStoredAnnotation(
  annotation: PdfAnnotationV2,
  onChangeAnnotationPublication = vi.fn(async ({ operation }: { operation: string }) => ({
    desiredVisibility: operation === "retract" ? "private" as const : "public" as const,
    ...(operation === "retract" ? {} : { remoteAnnotationId: "remote-1", remoteRevision: 2 }),
    state: operation === "retract" ? "not_published" as const : "published" as const
  }))
) {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [annotation]);
  render(
    <PdfReader
      onChangeAnnotationPublication={onChangeAnnotationPublication}
      selectedPapers={[paper]}
      zoom={100}
    />
  );
  return onChangeAnnotationPublication;
}

function makeRect() {
  return {
    bottom: 240,
    height: 20,
    left: 180,
    right: 340,
    toJSON: () => ({}),
    top: 220,
    width: 160,
    x: 180,
    y: 220
  } as DOMRect;
}

function selectPdfText(text: string) {
  const textLayer = document.querySelector(".pdf-text-layer");
  if (!textLayer) throw new Error("Expected PDF text layer");
  const span = document.createElement("span");
  span.textContent = text;
  textLayer.append(span);
  const rect = makeRect();
  vi.spyOn(window, "getSelection").mockReturnValue({
    getRangeAt: () => ({
      commonAncestorContainer: span.firstChild!,
      getBoundingClientRect: () => rect,
      getClientRects: () => ({ 0: rect, item: () => rect, length: 1 }),
    }) as unknown as Range,
    rangeCount: 1,
    removeAllRanges: vi.fn(),
    toString: () => text
  } as unknown as Selection);
  fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test.each(["高亮", "划线", "注释"])("creates %s privately by default", async (command) => {
  const onChangeAnnotationPublication = vi.fn();
  render(
    <PdfReader
      onChangeAnnotationPublication={onChangeAnnotationPublication}
      selectedPapers={[paper]}
      zoom={100}
    />
  );

  expect(screen.queryByRole("button", { name: "发到论坛" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "立即同步" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "新批注自动公开到论坛" })).not.toBeChecked();
  selectPdfText(`private ${command}`);
  await userEvent.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: command }));

  expect(screen.getByRole("checkbox", { name: /^公开到论坛$/u })).not.toBeChecked();
  expect(onChangeAnnotationPublication).not.toHaveBeenCalled();
  await waitFor(() => expect(window.localStorage.getItem(pdfAnnotationStorageKey(paper)!))
    .toContain('"desiredVisibility":"private"'));
});

test("does not auto-publish a duplicate selection that was not saved locally", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn(async () => ({
    desiredVisibility: "public" as const,
    remoteAnnotationId: "remote-duplicate",
    remoteRevision: 1,
    state: "published" as const
  }));
  render(
    <PdfReader
      onChangeAnnotationPublication={onChange}
      selectedPapers={[paper]}
      zoom={100}
    />
  );
  await user.click(screen.getByRole("checkbox", { name: "新批注自动公开到论坛" }));
  selectPdfText("first duplicate candidate");
  await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  selectPdfText("first duplicate candidate");
  await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onChange).toHaveBeenCalledTimes(1);
});

test("publishes one annotation from its visibility checkbox and exposes pending then confirmed truth", async () => {
  let finish!: (publication: PdfAnnotationPublication) => void;
  const onChange = vi.fn(() => new Promise<PdfAnnotationPublication>((resolve) => {
    finish = resolve;
  }));
  renderStoredAnnotation(publicationAnnotation(), onChange);

  const toggle = await screen.findByRole("checkbox", { name: /^公开到论坛$/u });
  await userEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operation: "publish", paper }));
  expect(screen.getByText("正在公开到论坛")).toBeInTheDocument();

  finish({
    desiredVisibility: "public",
    remoteAnnotationId: "remote-1",
    remoteRevision: 2,
    state: "published"
  });
  expect(await screen.findByText("已公开到论坛")).toBeInTheDocument();
});

test("collects bounded bibliographic hints without reading or forwarding PDF bytes and full text", async () => {
  const getData = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const hints = await collectPdfLiteratureHints(
    paper,
    {
      getData,
      getMetadata: vi.fn(async () => ({
        info: { Author: "Ada Lovelace", CreationDate: "D:20240101", Title: "Embedded title" },
        metadata: { get: vi.fn(() => undefined) }
      }))
    },
    `DOI: 10.1000/first-page\n${"private full text ".repeat(3_000)}`
  );

  expect(getData).not.toHaveBeenCalled();
  expect(hints).toEqual(expect.objectContaining({
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", value: "10.1000/reader" }],
    title: "Embedded title",
    year: 2024
  }));
  expect(JSON.stringify(hints)).not.toContain("private full text");
});

test("keeps the prior forum copy visible when a published note update fails", async () => {
  const onChange = vi.fn(async () => ({
    desiredVisibility: "public" as const,
    lastError: "network unavailable",
    remoteAnnotationId: "remote-1",
    remoteRevision: 4,
    state: "failed" as const
  }));
  renderStoredAnnotation(publicationAnnotation({
    desiredVisibility: "public",
    remoteAnnotationId: "remote-1",
    remoteRevision: 4,
    state: "published"
  }), onChange);

  await userEvent.click(await screen.findByRole("button", { name: /编辑批注/u }));
  fireEvent.change(screen.getByRole("textbox", { name: "补充批注笔记" }), {
    target: { value: "Updated public note" }
  });
  await userEvent.click(screen.getByRole("button", { name: "保存笔记" }));

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operation: "update" })));
  expect(await screen.findByText(/更新失败，论坛仍保留上一版本.*network unavailable/u)).toBeInTheDocument();
});

test("shows failed retract truth and refuses to delete the linked local annotation", async () => {
  const onChange = vi.fn(async () => ({
    desiredVisibility: "private" as const,
    lastError: "撤回未完成，论坛仍公开。timeout",
    remoteAnnotationId: "remote-1",
    remoteRevision: 4,
    state: "failed" as const
  }));
  renderStoredAnnotation(publicationAnnotation({
    desiredVisibility: "public",
    remoteAnnotationId: "remote-1",
    remoteRevision: 4,
    state: "published"
  }), onChange);

  await userEvent.click(await screen.findByRole("button", { name: /编辑批注/u }));
  await userEvent.click(screen.getByRole("button", { name: "删除" }));

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operation: "retract" })));
  expect(await screen.findByText(/撤回失败，论坛仍公开/u)).toBeInTheDocument();
  expect(screen.getByText("Publication evidence")).toBeInTheDocument();
});

test("deletes a published local annotation only after retract is confirmed", async () => {
  const onChange = vi.fn(async () => ({
    desiredVisibility: "private" as const,
    remoteAnnotationId: "remote-1",
    remoteRevision: 5,
    state: "not_published" as const
  }));
  renderStoredAnnotation(publicationAnnotation({
    desiredVisibility: "public",
    remoteAnnotationId: "remote-1",
    remoteRevision: 4,
    state: "published"
  }), onChange);

  await userEvent.click(await screen.findByRole("button", { name: /编辑批注/u }));
  await userEvent.click(screen.getByRole("button", { name: "删除" }));

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operation: "retract" })));
  await waitFor(() => expect(screen.queryByText("Publication evidence")).not.toBeInTheDocument());
});

test("cancels a queued create before it starts", () => {
  const onChange = renderStoredAnnotation(publicationAnnotation());
  const toggle = screen.getByRole("checkbox", { name: /^公开到论坛$/u });

  fireEvent.click(toggle);
  fireEvent.click(toggle);

  return waitFor(() => expect(onChange).not.toHaveBeenCalled());
});

test("queues an exact retract when visibility is disabled after create starts", async () => {
  let finishCreate!: (publication: PdfAnnotationPublication) => void;
  const onChange = vi.fn(({ operation }) => operation === "publish"
    ? new Promise<PdfAnnotationPublication>((resolve) => { finishCreate = resolve; })
    : Promise.resolve({
        desiredVisibility: "private" as const,
        remoteAnnotationId: "remote-1",
        remoteRevision: 3,
        state: "not_published" as const
      }));
  renderStoredAnnotation(publicationAnnotation(), onChange);
  const toggle = screen.getByRole("checkbox", { name: /^公开到论坛$/u });

  await userEvent.click(toggle);
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  await userEvent.click(toggle);
  expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ operation: "retract" }));
  finishCreate({
    desiredVisibility: "public",
    remoteAnnotationId: "remote-1",
    remoteRevision: 2,
    state: "published"
  });
  expect(await screen.findByText("未公开到论坛")).toBeInTheDocument();
});
