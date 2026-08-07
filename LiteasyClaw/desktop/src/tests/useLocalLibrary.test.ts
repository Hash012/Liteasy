import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type {
  LocalLibraryChangedEvent,
  LocalLibrarySnapshot,
  LocalLibraryWatchErrorEvent
} from "../app/features/library/localLibrary.types";
import { useLocalLibrary } from "../app/features/library/useLocalLibrary";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, listener: (event: { payload: unknown }) => void) => {
    tauri.listeners.set(name, listener);
    return tauri.unlisten;
  })
}));

function snapshot(revision: number): LocalLibrarySnapshot {
  return {
    entries: revision === 1 ? [{
      contentHash: "a".repeat(64),
      id: "document-1",
      path: "C:\\Library\\paper.pdf",
      relativePath: "paper.pdf",
      title: "Paper"
    }] : [],
    folders: [],
    libraryId: "library-1",
    revision,
    rootPath: "C:\\Library",
    trashEntries: []
  };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockResolvedValue(snapshot(1));
  tauri.listeners.clear();
  tauri.unlisten.mockReset();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: vi.fn() }
  });
});

test("updates the snapshot and reports a deletion performed outside Liteasy", async () => {
  const { result, unmount } = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(result.current.snapshot?.revision).toBe(1));
  await waitFor(() => expect(tauri.listeners.has("local-library-changed")).toBe(true));

  const changed: LocalLibraryChangedEvent = {
    externalDeletion: true,
    fullRescan: false,
    paths: ["C:\\Library\\paper.pdf"],
    revision: 2,
    snapshot: snapshot(2)
  };
  act(() => {
    tauri.listeners.get("local-library-changed")?.({ payload: changed });
  });

  expect(result.current.snapshot?.entries).toEqual([]);
  expect(result.current.notice).toBe("文件已在系统外删除，本地文献库已从磁盘更新。");
  unmount();
  expect(tauri.unlisten).toHaveBeenCalledTimes(2);
});

test("shows a retryable watcher error with its safe trace ID", async () => {
  const { result } = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(tauri.listeners.has("local-library-watch-error")).toBe(true));

  const failure: LocalLibraryWatchErrorEvent = {
    code: "local_library_rescan_failed",
    message: "无法刷新本地文献库，请重试。",
    traceId: "trace_local_watch_1"
  };
  act(() => {
    tauri.listeners.get("local-library-watch-error")?.({ payload: failure });
  });

  expect(result.current.error).toBe(
    "无法刷新本地文献库，请重试。（错误编号：trace_local_watch_1）"
  );
});
