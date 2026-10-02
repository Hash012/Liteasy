import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ObjectStorage, StorageRow } from "../app/features/objects/objectStorage";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createPdfReaderPositionStore, pdfReaderContentRevision } from "../app/features/pdf/pdfReaderPosition";
import { usePdfReaderPosition, type PdfReaderPositionInput } from "../app/features/pdf/usePdfReaderPosition";

vi.mock("../app/features/objects/objectStorage", () => ({ createObjectStorage: vi.fn() }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function memory() {
  const rows = new Map<string, StorageRow>();
  const storage: ObjectStorage = {
    get: vi.fn(async (key) => rows.get(key) ?? null),
    list: vi.fn(async () => [...rows.values()]),
    commit: vi.fn(async (changes) => { for (const change of changes) {
      if ((rows.get(change.key)?.version ?? null) !== change.expected) throw new Error("revision_conflict");
      if (change.row) rows.set(change.key, change.row); else rows.delete(change.key);
    } })
  };
  return { rows, storage };
}
const key = "reader-state/pdf/paper-a";
function saved(page = 8, revision = "sha256:aaa"): StorageRow {
  return { key, version: "old", value: { schemaVersion: 1, paperId: "paper-a", contentRevision: revision, page, updatedAt: "2026-10-03T00:00:00.000Z" } };
}
let state: ReturnType<typeof memory>;
beforeEach(() => { state = memory(); vi.mocked(createObjectStorage).mockReturnValue(state.storage); });

function input(overrides: Partial<PdfReaderPositionInput> = {}): PdfReaderPositionInput {
  return { scopeId: "local", paperId: "paper-a", sourcePath: "/fixture/a.pdf", document: {}, contentRevision: "sha256:aaa", pageCount: 12, page: 1, restorePage: vi.fn(), ...overrides };
}

test("hydration never checkpoints initial page 1 and waits for an actual loaded document", async () => {
  state.rows.set(key, saved());
  const read = deferred<StorageRow | null>(); vi.mocked(state.storage.get).mockReturnValueOnce(read.promise);
  const restorePage = vi.fn(); const options = input({ document: null, restorePage });
  const { rerender } = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
  expect(state.storage.get).not.toHaveBeenCalled();
  rerender({ ...options, document: {} });
  expect(state.storage.commit).not.toHaveBeenCalled();
  await act(async () => { read.resolve(saved()); });
  expect(restorePage).toHaveBeenCalledWith(8, expect.any(Function));
  expect(state.storage.commit).not.toHaveBeenCalled();
});

test("explicit navigation and evidence targets win over a delayed restored position", async () => {
  for (const evidence of [false, true]) {
    const read = deferred<StorageRow | null>(); vi.mocked(state.storage.get).mockReturnValueOnce(read.promise);
    const options = input({ hasNavigationTarget: evidence });
    const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
    if (!evidence) act(() => hook.result.current.markNavigation());
    hook.rerender({ ...options, page: 3 });
    await act(async () => { read.resolve(saved()); });
    expect(options.restorePage).not.toHaveBeenCalled();
    await waitFor(() => expect((state.rows.get(key)?.value as { page: number }).page).toBe(3));
    hook.unmount();
  }
});

test("late A hydration cannot restore or save B, and a restored page is clamped", async () => {
  const read = deferred<StorageRow | null>(); vi.mocked(state.storage.get).mockReturnValueOnce(read.promise);
  const first = input(); const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: first });
  const second = input({ paperId: "paper-b", sourcePath: "/fixture/b.pdf", document: null });
  hook.rerender(second);
  await act(async () => { read.resolve(saved()); });
  expect(first.restorePage).not.toHaveBeenCalled(); expect(second.restorePage).not.toHaveBeenCalled();
  expect(state.storage.commit).not.toHaveBeenCalled();
  state.rows.set(key, saved(20));
  const reopened = input({ pageCount: 5 }); hook.rerender(reopened);
  await waitFor(() => expect(reopened.restorePage).toHaveBeenCalledWith(5, expect.any(Function)));
});

test("changing content revision starts at the current page without overwriting on load", async () => {
  state.rows.set(key, saved());
  const options = input({ contentRevision: "sha256:bbb" });
  renderHook(() => usePdfReaderPosition(options));
  await act(async () => {});
  expect(options.restorePage).not.toHaveBeenCalled(); expect(state.storage.commit).not.toHaveBeenCalled();
  expect(pdfReaderContentRevision(undefined, ["original", "edit-2"]))
    .not.toBe(pdfReaderContentRevision(undefined, ["original", "edit-1"]));
});

test.each([99, "corrupt"])("unsupported or corrupt state %s stays intact and blocks writes", async (schemaVersion) => {
  const row = saved(); row.value = schemaVersion === "corrupt" ? { schemaVersion: 1, page: "eight" } : { ...(row.value as object), schemaVersion };
  state.rows.set(key, row);
  const options = input(); const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
  await waitFor(() => expect(hook.result.current.error).toMatch(/阅读位置/));
  act(() => hook.result.current.markNavigation()); hook.rerender({ ...options, page: 4 });
  await act(async () => {});
  expect(state.storage.commit).not.toHaveBeenCalled(); expect(state.rows.get(key)).toEqual(row);
});

test("captured scope and record keys isolate delayed writes; writes remain ordered", async () => {
  let scope = "local";
  const store = createPdfReaderPositionStore("local", () => scope, state.storage);
  const firstCommit = deferred<void>();
  vi.mocked(state.storage.commit).mockImplementationOnce(async (changes) => { await firstCommit.promise; for (const change of changes) state.rows.set(change.key, change.row!); });
  const first = store.save("paper-a", "sha256:aaa", 2);
  const next = store.save("paper-a", "sha256:aaa", 9);
  await waitFor(() => expect(state.storage.commit).toHaveBeenCalledTimes(1));
  firstCommit.resolve(); await Promise.all([first, next]);
  expect((state.rows.get(key)?.value as { page: number }).page).toBe(9);
  scope = "user:other";
  await expect(store.save("paper-a", "sha256:aaa", 3)).rejects.toThrow(/账号/);
  expect((state.rows.get(key)?.value as { page: number }).page).toBe(9);
});

test("a future row arriving between hydrate and save and a CAS conflict are never overwritten", async () => {
  const store = createPdfReaderPositionStore("local", () => "local", state.storage);
  state.rows.set(key, saved()); expect(await store.load("paper-a", "sha256:aaa")).toBe(8);
  state.rows.set(key, { ...saved(), value: { schemaVersion: 2 } });
  await expect(store.save("paper-a", "sha256:aaa", 9)).rejects.toThrow();
  expect(state.storage.commit).not.toHaveBeenCalled();
  state.rows.set(key, saved()); vi.mocked(state.storage.commit).mockRejectedValueOnce(new Error("revision_conflict"));
  await expect(store.save("paper-a", "sha256:aaa", 9)).rejects.toThrow("revision_conflict");
  expect(state.storage.commit).toHaveBeenCalledTimes(1);
});

test("a new revision at the same paper and path discards the previous opening's navigation intent", async () => {
  const options = input(); const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
  await act(async () => {});
  act(() => hook.result.current.markNavigation()); hook.rerender({ ...options, page: 3 });
  await waitFor(() => expect((state.rows.get(key)?.value as { page: number }).page).toBe(3));
  state.rows.set(key, saved(9, "sha256:bbb"));
  const restorePage = vi.fn();
  hook.rerender({ ...options, page: 1, contentRevision: "sha256:bbb", restorePage });
  await waitFor(() => expect(restorePage).toHaveBeenCalledWith(9, expect.any(Function)));
  expect((state.rows.get(key)?.value as { page: number }).page).toBe(9);
});

test("switching scope discards a delayed response and never copies a page into the new scope", async () => {
  const read = deferred<StorageRow | null>(); vi.mocked(state.storage.get).mockReturnValueOnce(read.promise);
  const options = input(); const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
  await waitFor(() => expect(state.storage.get).toHaveBeenCalledTimes(1));
  const other = memory();
  vi.mocked(createObjectStorage).mockReturnValue(other.storage);
  const restorePage = vi.fn();
  hook.rerender({ ...options, scopeId: "user:other", restorePage });
  await act(async () => { read.resolve(saved()); });
  expect(options.restorePage).not.toHaveBeenCalled(); expect(restorePage).not.toHaveBeenCalled();
  expect(state.storage.commit).not.toHaveBeenCalled();
});

test("manual navigation invalidates an already queued restore scroll", async () => {
  state.rows.set(key, saved()); const options = input();
  const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
  await waitFor(() => expect(options.restorePage).toHaveBeenCalled());
  const stillCurrent = vi.mocked(options.restorePage).mock.calls[0][1];
  act(() => hook.result.current.markNavigation()); hook.rerender({ ...options, page: 2 });
  expect(stillCurrent()).toBe(false);
  await waitFor(() => expect((state.rows.get(key)?.value as { page: number }).page).toBe(2));
});

test("storage read failure leaves the original row untouched and presents recovery failure", async () => {
  state.rows.set(key, saved()); vi.mocked(state.storage.get).mockRejectedValueOnce(new Error("disk unavailable"));
  const options = input(); const hook = renderHook((props) => usePdfReaderPosition(props), { initialProps: options });
  await waitFor(() => expect(hook.result.current.error).toContain("disk unavailable"));
  act(() => hook.result.current.markNavigation()); hook.rerender({ ...options, page: 3 });
  expect(state.storage.commit).not.toHaveBeenCalled();
  expect(state.rows.get(key)).toEqual(saved());
});
