import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useLibraryController } from "../app/controllers/useLibraryController";
import type { LibraryItem, LibraryRepository } from "../app/features/library/library.types";

const item: LibraryItem = { id: "remote", kind: "pdf", title: "远端文献", filename: "paper.pdf", mimeType: "application/pdf",
  contentHash: "a".repeat(64), size: 100, collection: "收件箱", tags: [], note: "", createdAt: "now", updatedAt: "now",
  page: 1, pinned: false, downloaded: false, revision: 1 };
function repository(ensureAvailable: LibraryRepository["ensureAvailable"]) {
  return { list: vi.fn().mockResolvedValue([item]), ensureAvailable,
    update: vi.fn(async (_scope, value) => ({ ...value, revision: value.revision + 1 })) } as unknown as LibraryRepository;
}
test("lists remote entries immediately and downloads only the clicked entry before opening", async () => {
  let finish!: (value: LibraryItem) => void;
  const ensure = vi.fn(() => new Promise<LibraryItem>((resolve) => { finish = resolve; }));
  const repo = repository(ensure);
  const hook = renderHook(() => useLibraryController("local", repo));
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  expect(ensure).not.toHaveBeenCalled();
  act(() => hook.result.current.open(item));
  expect(ensure).toHaveBeenCalledWith("local", item.id, item.contentHash);
  expect(hook.result.current.selectedId).toBeUndefined();
  await act(async () => { finish({ ...item, downloaded: true, revision: 2 }); });
  await waitFor(() => expect(hook.result.current.selectedId).toBe(item.id));
  expect(repo.update).toHaveBeenCalledWith("local", expect.objectContaining({ downloaded: true, revision: 2 }));
});
test("failed downloads leave the entry unopened and can be retried", async () => {
  const ensure = vi.fn().mockRejectedValueOnce(new Error("网络不可用")).mockResolvedValue({ ...item, downloaded: true });
  const repo = repository(ensure);
  const hook = renderHook(() => useLibraryController("local", repo));
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  act(() => hook.result.current.open(item));
  await waitFor(() => expect(hook.result.current.error).toBe("网络不可用"));
  expect(hook.result.current.selectedId).toBeUndefined();
  act(() => hook.result.current.open(item));
  await waitFor(() => expect(hook.result.current.selectedId).toBe(item.id));
});
test("closing or switching accounts during a download rejects late selection", async () => {
  let finish!: (value: LibraryItem) => void;
  const ensure = vi.fn(() => new Promise<LibraryItem>((resolve) => { finish = resolve; }));
  const repo = repository(ensure);
  const hook = renderHook(({ scope }) => useLibraryController(scope, repo), { initialProps: { scope: "local" } });
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  act(() => hook.result.current.open(item));
  hook.rerender({ scope: "account:b" });
  hook.rerender({ scope: "local" });
  await act(async () => { finish({ ...item, downloaded: true }); });
  expect(repo.update).not.toHaveBeenCalled();
  expect(hook.result.current.selectedId).toBeUndefined();
});
