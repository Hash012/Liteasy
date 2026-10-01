import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useLibraryController } from "../app/controllers/useLibraryController";
import type { LibraryItem, LibraryRepository } from "../app/features/library/library.types";

test("account changes hide old items immediately and reject late library reads", async () => {
  let finishOld!: (items: LibraryItem[]) => void;
  const old = { id: "old-paper", title: "Old account document" } as LibraryItem;
  const current = { id: "new-paper", title: "Current account document" } as LibraryItem;
  const repository = { list: vi.fn().mockResolvedValueOnce([old]).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockResolvedValue([current]),
    importResource: vi.fn(), update: vi.fn(), readBytes: vi.fn(), readRecord: vi.fn(), writeRecord: vi.fn() } as LibraryRepository;
  const { result, rerender } = renderHook(({ scope }) => useLibraryController(scope, repository), { initialProps: { scope: "account:old" } });
  await waitFor(() => expect(result.current.items).toEqual([old]));
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  rerender({ scope: "account:new" });
  expect(result.current.items).toEqual([]);
  await waitFor(() => expect(result.current.items).toEqual([current]));
  await act(async () => { finishOld([old]); await pending; });
  expect(result.current.items).toEqual([current]);
});
