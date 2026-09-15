import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

test("entry review sends authoritative quote and user text through the public Agent without consuming board context", async () => {
  let current: ReturnType<typeof useObjectWorkbenchController>;
  const scopeId = crypto.randomUUID();
  const received: Array<{ prompt: string; text: string }> = [];
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    getPrincipalId: () => scopeId,
    resolveContext: async ({ request }) => ({
      objectSnapshot: await current.resolveContext(request),
    }),
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async ({ request, context }) => {
      received.push({
        prompt: request.input.message,
        text: context
          .objectSnapshot!.entries.map((entry) => entry.text)
          .join("\n"),
      });
      return { message: "需要补充反例。" };
    },
  });
  const paper = {
    id: "review-paper",
    title: "Paper",
    contentHash: "pdf-content",
  };
  const hook = renderHook(() =>
    useObjectWorkbenchController({
      scopeId,
      getApi: () => api,
      getPapers: () => [paper],
      getSettings: () => createSettingsStore().getState(),
      openEvidence: vi.fn(),
    }),
  );
  current = hook.result.current;
  await act(async () => {
    await current.port.capturePdf(
      { paper, page: 1, excerpt: "保留在白板上下文中的内容", rects: [] },
      "tray",
    );
  });
  current = hook.result.current;
  await act(async () => {
    current.setTray((items) =>
      items.map((item) => ({ ...item, pinned: true })),
    );
  });
  current = hook.result.current;
  const tray = current.tray;
  const annotation: PdfAnnotationV2 = {
    id: "entry",
    kind: "highlight",
    page: 1,
    paperIdentity: resolvePaperIdentity(paper),
    excerpt: "原文证据",
    text: "原文证据",
    note: "我的理解",
    images: {},
    rects: [],
    revision: 1,
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    publication: { desiredVisibility: "private", state: "not_published" },
  };
  await act(async () => {
    expect(
      await current.port.reviewAnnotation!(
        { paper, annotation },
        new AbortController().signal,
      ),
    ).toBe("需要补充反例。");
  });
  expect(received).toHaveLength(1);
  expect(received[0].prompt).toContain("一致的语言");
  expect(received[0].text).toContain("原文证据");
  expect(received[0].text).toContain("我的理解");
  expect(received[0].text).not.toContain("保留在白板上下文中的内容");
  expect(hook.result.current.tray).toEqual(tray);
  expect(hook.result.current.answer).toBeUndefined();
  expect(hook.result.current.placements).toHaveLength(0);
  hook.unmount();
});

test("saved annotation capture preserves notes, source quote, attachment and identity", async () => {
  const paper = {
    id: "annotated-paper",
    title: "Annotated paper",
    contentHash: "pdf-hash",
  };
  const { result, unmount } = renderHook(() =>
    useObjectWorkbenchController({
      scopeId: "annotation-controller-test",
      getApi: () => {
        throw new Error("No model call expected");
      },
      getPapers: () => [paper],
      getSettings: () => createSettingsStore().getState(),
      openEvidence: vi.fn(),
    }),
  );
  const annotation: PdfAnnotationV2 = {
    id: "saved-annotation",
    kind: "highlight",
    page: 2,
    paperIdentity: resolvePaperIdentity(paper),
    excerpt: "原始引文",
    text: "原始引文",
    note: "我的批注\n\n![图](attachment:figure)\n\n![重复图片](attachment:duplicate)",
    images: {
      figure:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wSAAAAAASUVORK5CYII=",
      duplicate:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wSAAAAAASUVORK5CYII=",
    },
    rects: [{ left: 5, top: 10, width: 30, height: 4 }],
    revision: 1,
    createdAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:00Z",
    publication: { desiredVisibility: "private", state: "not_published" },
  };
  let first: Awaited<
    ReturnType<NonNullable<typeof result.current.port.captureAnnotation>>
  >;
  await act(async () => {
    first = await result.current.port.captureAnnotation!(
      { paper, annotation },
      "board",
    );
  });
  const captured = await result.current.repository.get(first![0]);
  expect(captured.kind).toBe("content.fragment");
  if (captured.kind !== "content.fragment")
    throw new Error("Expected fragment");
  expect(captured.content.payload.text).toContain("我的批注");
  expect(captured.content.payload.anchors[0]).toMatchObject({
    page: 2,
    quote: { exact: "原始引文" },
    documentHash: "pdf-hash",
  });
  expect(captured.assets).toHaveLength(1);
  expect(
    await result.current.repository.readAsset(captured.assets[0].assetId),
  ).toBeTruthy();
  const copy = await result.current.repository.copy(first![0]);
  expect(copy.assets).toEqual(captured.assets);
  await act(async () => {
    const repeated = await result.current.port.captureAnnotation!(
      { paper, annotation },
      "board",
    );
    expect(repeated).toEqual(first);
  });
  expect(result.current.placements).toHaveLength(2);
  await act(async () => {
    await result.current.port.captureAnnotation!(
      {
        paper,
        annotation: { ...annotation, note: "修订后的批注", revision: 2 },
      },
      "board",
    );
  });
  expect(
    result.current.objects.filter(
      (object) => object.kind === "content.fragment",
    ),
  ).toHaveLength(1);
  expect(
    await result.current.repository.history(captured.objectId),
  ).toHaveLength(2);
  let pendingCapture: Promise<unknown>;
  act(() => {
    pendingCapture = result.current.port.captureAnnotation!(
      {
        paper,
        annotation: {
          ...annotation,
          id: "text-box",
          kind: "text",
          excerpt: "",
          text: "",
          note: "区域文本笔记",
          images: {},
        },
      },
      "board",
    );
    result.current.port.close!();
  });
  await act(async () => {
    await pendingCapture;
  });
  expect(result.current.visible).toBe(false);
  expect(result.current.placements).toHaveLength(4);
  const textBox = result.current.objects.find(
    (object) =>
      object.kind === "content.fragment" &&
      object.content.payload.text === "区域文本笔记",
  );
  expect(
    textBox?.kind === "content.fragment" && textBox.content.payload.anchors[0],
  ).toMatchObject({
    type: "pdf",
    quote: { exact: "" },
    rects: [{ x: 0.05, y: 0.1, width: 0.3, height: 0.04 }],
  });
  unmount();
});

test("closing the board cancels a pending reveal from a drag gesture", async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() =>
    useObjectWorkbenchController({
      scopeId: "close-drag-test",
      getApi: () => {
        throw new Error("No model call expected");
      },
      getPapers: () => [],
      getSettings: () => createSettingsStore().getState(),
      openEvidence: vi.fn(),
    }),
  );
  act(() => {
    result.current.port.dragMessage(
      { messageId: "message", text: "正文", excerpt: "正文", partial: false },
      { setData: vi.fn() } as unknown as DataTransfer,
    );
    result.current.port.close!();
    vi.advanceTimersByTime(100);
  });
  expect(result.current.visible).toBe(false);
  unmount();
  vi.useRealTimers();
});
test("tray selections remain temporary until submit, then produce a saved artifact with frozen sources", async () => {
  let current: ReturnType<typeof useObjectWorkbenchController>;
  const scopeId = crypto.randomUUID();
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    getPrincipalId: () => scopeId,
    resolveContext: async ({ request }) => ({
      objectSnapshot: await current.resolveContext(request),
    }),
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async () => ({ message: "解释内容" }),
  });
  const paper = { id: "paper", title: "Paper", contentHash: "original-hash" };
  const hook = renderHook(() =>
    useObjectWorkbenchController({
      scopeId,
      getApi: () => api,
      getPapers: () => [paper],
      getSettings: () => createSettingsStore().getState(),
      openEvidence: vi.fn(),
    }),
  );
  current = hook.result.current;
  await act(async () => {
    await current.port.capturePdf(
      {
        paper,
        page: 3,
        excerpt: "原文",
        rects: [{ left: 20, top: 30, width: 40, height: 5 }],
      },
      "tray",
    );
  });
  await waitFor(() =>
    expect(
      hook.result.current.objects.some((o) => o.kind === "source.document"),
    ).toBe(true),
  );
  current = hook.result.current;
  expect(
    (await current.repository.search()).objects.filter(
      (o) => o.kind === "content.fragment",
    ),
  ).toHaveLength(0);
  await act(async () => {
    await current.previewContext();
  });
  current = hook.result.current;
  expect(current.preview?.entries[0].text).toBe("原文");
  await act(async () => {
    await current.submit("解释");
  });
  current = hook.result.current;
  expect(current.answer?.text).toBe("解释内容");
  const fragment = (await current.repository.search()).objects.find(
    (o) => o.kind === "content.fragment",
  )!;
  if (fragment.kind !== "content.fragment") throw new Error("fragment");
  expect(fragment.content.payload.anchors[0]).toMatchObject({
    page: 3,
    rects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.05 }],
  });
  let first: unknown, second: unknown;
  await act(async () => {
    first = await current.saveAnswer();
  });
  current = hook.result.current;
  await act(async () => {
    second = await current.saveAnswer();
  });
  expect(second).toEqual(first);
  expect(
    (await current.repository.search()).objects.filter(
      (o) => o.kind === "artifact.document",
    ),
  ).toHaveLength(1);
  hook.unmount();
});
