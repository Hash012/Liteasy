import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useRecommendationLibraryController } from "../app/controllers/useRecommendationLibraryController";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

const io = vi.hoisted(() => ({ load: vi.fn(), createLocalLibraryFolder: vi.fn(), persistPdfByteStream: vi.fn(), downloadRecommendationPdf: vi.fn() }));
vi.mock("../app/features/library/localLibraryClient", () => ({ createLocalLibraryClient: () => io.load }));
vi.mock("../app/features/library/libraryFileSystemClient", () => io);
vi.mock("../app/features/recommendations/recommendationPdfClient", () => io);
const item = { id: "rec", title: "Paper: one" } as RecommendationItem;
const folder = { name: "Download", parentPath: "D:/Library", path: "D:/Library/Download" };
const snapshot = { entries: [], folders: [], rootPath: "D:/Library" };

beforeEach(() => {
  vi.resetAllMocks();
  io.load.mockResolvedValue(snapshot);
  io.createLocalLibraryFolder.mockResolvedValue({ ...snapshot, folders: [folder] });
  io.downloadRecommendationPdf.mockResolvedValue({ bytes: new TextEncoder().encode("%PDF-1.7"), contentHash: "hash" });
  io.persistPdfByteStream.mockResolvedValue({ ...snapshot, entries: [{ id: "paper", contentHash: "hash", path: "D:/Library/Download/Paper one.pdf" }] });
});

test("downloads once to the local Download folder and preserves provider metadata after import", async () => {
  const refreshLocalLibrary = vi.fn();
  const onSaved = vi.fn();
  const onImportedMetadata = vi.fn();
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "user:a:library", endpoint: "https://cloud.test", refreshLocalLibrary, onSaved, onImportedMetadata }));
  await act(async () => {
    const first = result.current.download(item);
    expect(result.current.download(item)).toBe(first);
    expect(await first).toContain("已下载");
  });
  expect(io.createLocalLibraryFolder).toHaveBeenCalledExactlyOnceWith("Download", "D:/Library");
  const request = io.persistPdfByteStream.mock.calls[0][0];
  expect(request.targetFolderPath).toBe(folder.path);
  expect(request.fileName).toBe("Paper one.pdf");
  expect(await new Response(request.stream).text()).toBe("%PDF-1.7");
  expect(refreshLocalLibrary).toHaveBeenCalledOnce();
  expect(onImportedMetadata).toHaveBeenCalledWith("paper", item);
  expect(onSaved).toHaveBeenCalledWith(item);
});

test("reuses Download and leaves existing duplicate metadata unchanged", async () => {
  io.load.mockResolvedValue({ ...snapshot, folders: [folder], entries: [{ id: "paper", contentHash: "hash" }] });
  const onImportedMetadata = vi.fn();
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "user:a:library", endpoint: "", refreshLocalLibrary: vi.fn(), onSaved: vi.fn(), onImportedMetadata }));
  await act(async () => { await result.current.download(item); });
  expect(io.createLocalLibraryFolder).not.toHaveBeenCalled();
  expect(onImportedMetadata).not.toHaveBeenCalled();
  expect(io.persistPdfByteStream.mock.calls[0][0].onDuplicate()).toBe(false);
});

test("reports unavailable full text without creating a misleading metadata-only download", async () => {
  io.downloadRecommendationPdf.mockResolvedValue(null);
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "user:a:library", endpoint: "", refreshLocalLibrary: vi.fn(), onSaved: vi.fn() }));
  await expect(result.current.download(item)).rejects.toThrow("暂未提供可下载的开放 PDF");
  expect(io.createLocalLibraryFolder).not.toHaveBeenCalled();
  expect(io.persistPdfByteStream).not.toHaveBeenCalled();
});

test("does not write into a different account after an in-flight download completes", async () => {
  let finish!: (value: unknown) => void;
  io.downloadRecommendationPdf.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ scopeKey }) => useRecommendationLibraryController({
    scopeKey, endpoint: "", refreshLocalLibrary: vi.fn(), onSaved: vi.fn(),
  }), { initialProps: { scopeKey: "user:a:library" } });
  act(() => result.current.select(item));
  const task = result.current.download(item);
  const rejection = expect(task).rejects.toThrow("账号或数据目录已切换");
  await waitFor(() => expect(io.downloadRecommendationPdf).toHaveBeenCalledOnce());
  rerender({ scopeKey: "user:b:library" });
  expect(result.current.selected).toBeUndefined();
  finish({ bytes: new TextEncoder().encode("%PDF-1.7"), contentHash: "hash" });
  await rejection;
  expect(io.persistPdfByteStream).not.toHaveBeenCalled();
  expect(io.createLocalLibraryFolder).not.toHaveBeenCalled();
});
