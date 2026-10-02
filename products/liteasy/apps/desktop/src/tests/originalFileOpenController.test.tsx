import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useOriginalFileOpenController } from "../app/controllers/useOriginalFileOpenController";
import type { OriginalFileDescriptor, OriginalFileService } from "../app/features/original-files/originalFileService";

const pdf: OriginalFileDescriptor = { id: "pdf-grant", path: "/synthetic/manual.pdf", fileName: "manual.pdf", format: "pdf", sizeBytes: 12, modifiedUnixMs: 1000 };
const epub: OriginalFileDescriptor = { ...pdf, id: "epub-grant", path: "/synthetic/book.epub", fileName: "book.epub", format: "epub" };
function harness(overrides: Partial<OriginalFileService> = {}) {
  const service: OriginalFileService = {
    choose: vi.fn(async () => null), read: vi.fn(async () => new Uint8Array([1, 2])), release: vi.fn(async () => undefined),
    drain: vi.fn(async () => ({ files: [], errors: [] })), subscribe: vi.fn(async () => vi.fn()),
    ...overrides
  };
  const onOpenPdf = vi.fn(async () => undefined);
  const onOpenEpub = vi.fn(async () => undefined);
  const onError = vi.fn();
  const result = renderHook(({ scopeId }) => useOriginalFileOpenController({
    scopeId, service, onOpenPdf, onOpenEpub, onError
  }), { initialProps: { scopeId: "local" } });
  return { result, service, onOpenPdf, onOpenEpub, onError };
}

test("drains queued native open requests once after listening and reads them sequentially", async () => {
  const order: string[] = [];
  const h = harness({
    subscribe: vi.fn(async () => { order.push("listen"); return vi.fn(); }),
    drain: vi.fn(async () => { order.push("drain"); return { files: [pdf, epub], errors: [] }; }),
    read: vi.fn(async (file) => { order.push(file.id); return new Uint8Array([1]); })
  });
  await waitFor(() => expect(h.onOpenEpub).toHaveBeenCalledTimes(1));
  expect(order).toEqual(["listen", "drain", "pdf-grant", "epub-grant"]);
  expect(h.onOpenPdf).toHaveBeenCalledWith(pdf, new Uint8Array([1]));
  expect(h.onOpenEpub).toHaveBeenCalledWith(epub, new Uint8Array([1]));
  expect(h.service.release).toHaveBeenCalledWith(epub);
  expect(h.service.release).not.toHaveBeenCalledWith(pdf);
  expect(h.onError).not.toHaveBeenCalled();
});

test("cancelled picker creates no document and busy prevents a second dialog", async () => {
  let finish!: (file: OriginalFileDescriptor | null) => void;
  const h = harness({ choose: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
  await waitFor(() => expect(h.service.drain).toHaveBeenCalled());
  let opening!: Promise<void>;
  act(() => { opening = h.result.result.current.openFile(); });
  expect(h.result.result.current.busy).toBe(true);
  await act(async () => { await h.result.result.current.openFile(); });
  expect(h.service.choose).toHaveBeenCalledTimes(1);
  await act(async () => { finish(null); await opening; });
  expect(h.result.result.current.busy).toBe(false);
  expect(h.service.read).not.toHaveBeenCalled();
});

test("cleans up a listener that registers after unmount without draining", async () => {
  let finish!: (unsubscribe: () => void) => void;
  const unsubscribe = vi.fn();
  const h = harness({ subscribe: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
  h.result.unmount();
  await act(async () => { finish(unsubscribe); });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(h.service.drain).not.toHaveBeenCalled();
});

test("does not open delayed original bytes after switching accounts", async () => {
  let finish!: (bytes: Uint8Array) => void;
  const h = harness({ choose: vi.fn(async () => pdf), read: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
  await waitFor(() => expect(h.service.drain).toHaveBeenCalled());
  let opening!: Promise<void>;
  act(() => { opening = h.result.result.current.openFile(); });
  await waitFor(() => expect(h.service.read).toHaveBeenCalledTimes(1));
  h.result.rerender({ scopeId: "user:other" });
  await act(async () => { finish(new Uint8Array([1])); await opening; });
  expect(h.onOpenPdf).not.toHaveBeenCalled();
  expect(h.service.release).toHaveBeenCalledWith(pdf);
});

test("a failed original read releases its grant and does not stop the next queued file", async () => {
  const h = harness({
    drain: vi.fn(async () => ({ files: [pdf, epub], errors: [{ code: "unsupported", message: "不支持的文件格式" }] })),
    read: vi.fn().mockRejectedValueOnce(new Error("文件已更改，请重新选择。")).mockResolvedValueOnce(new Uint8Array([1]))
  });
  await waitFor(() => expect(h.onOpenEpub).toHaveBeenCalledTimes(1));
  expect(h.service.release).toHaveBeenCalledWith(pdf);
  expect(h.onOpenPdf).not.toHaveBeenCalled();
  expect(h.onError.mock.calls).toEqual([["不支持的文件格式"], ["文件已更改，请重新选择。"]]);
});

test("a native wakeup during a picker opens its batch after the chooser finishes", async () => {
  let wake!: () => void;
  let finish!: (file: OriginalFileDescriptor | null) => void;
  const drain = vi.fn().mockResolvedValueOnce({ files: [], errors: [] }).mockResolvedValueOnce({ files: [pdf], errors: [] });
  const h = harness({
    subscribe: vi.fn(async (callback) => { wake = callback; return vi.fn(); }), drain,
    choose: vi.fn(() => new Promise((resolve) => { finish = resolve; }))
  });
  await waitFor(() => expect(h.service.drain).toHaveBeenCalledTimes(1));
  let opening!: Promise<void>;
  act(() => { opening = h.result.result.current.openFile(); });
  act(() => wake());
  expect(drain).toHaveBeenCalledTimes(1);
  await act(async () => { finish(null); await opening; });
  await waitFor(() => expect(h.onOpenPdf).toHaveBeenCalledTimes(1));
  expect(drain).toHaveBeenCalledTimes(2);
});
