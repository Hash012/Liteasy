import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useRecommendationLibraryController } from "../app/controllers/useRecommendationLibraryController";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { LiteratureAuthorityClient } from "../app/features/paper-identity/literatureAuthorityClient";

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

test("downloads into an existing chosen folder and never creates Download as a side effect", async () => {
  const chosen = { name: "Memory", path: "D:/Library/Research/Memory", parentPath: "D:/Library/Research" };
  io.load.mockResolvedValue({ ...snapshot, folders: [chosen] });
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "local", endpoint: "", refreshLocalLibrary: vi.fn(), onSaved: vi.fn() }));
  await act(async () => { expect(await result.current.download(item, { targetFolderPath: chosen.path })).toContain(chosen.path); });
  expect(io.persistPdfByteStream.mock.calls[0][0].targetFolderPath).toBe(chosen.path);
  expect(io.createLocalLibraryFolder).not.toHaveBeenCalled();
});

test("creates a named subdirectory under the chosen parent and rejects a removed or external folder", async () => {
  io.load.mockResolvedValue({ ...snapshot, folders: [folder] });
  io.createLocalLibraryFolder.mockResolvedValue({ ...snapshot, folders: [folder, { name: "Memory", parentPath: folder.path, path: folder.path + "/Memory" }] });
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "local", endpoint: "", refreshLocalLibrary: vi.fn(), onSaved: vi.fn() }));
  await act(async () => { await result.current.download(item, { targetFolderPath: folder.path, newFolderName: "Memory" }); });
  expect(io.createLocalLibraryFolder).toHaveBeenCalledWith("Memory", folder.path);
  expect(io.persistPdfByteStream.mock.calls[0][0].targetFolderPath).toBe(folder.path + "/Memory");
  io.persistPdfByteStream.mockClear();
  await expect(result.current.download(item, { targetFolderPath: "C:/Elsewhere" })).rejects.toThrow("目录已不存在");
  expect(io.persistPdfByteStream).not.toHaveBeenCalled();
});

test("single selection leaves the open page unchanged, and late metadata cannot replace a newer page", async () => {
  let finish!: (value: unknown) => void;
  const metadataClient = { resolveLiterature: vi.fn(() => new Promise((resolve) => { finish = resolve; })) } as unknown as LiteratureAuthorityClient;
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "local", endpoint: "", metadataClient,
    refreshLocalLibrary: vi.fn(), onSaved: vi.fn() }));
  let request!: Promise<void>;
  act(() => { request = result.current.open({ ...item, id: "doi:10.1234/first" }); });
  act(() => result.current.select({ ...item, id: "selected-only" }));
  expect(result.current.preview?.item.id).toBe("doi:10.1234/first");
  await act(async () => { await result.current.open({ ...item, id: "no-identifier", title: "Second paper" }); });
  await act(async () => { finish({ status: "exact", candidate: { record: { title: "Late first", identifiers: [{ kind: "doi", value: "10.1234/first" }] } } }); await request; });
  expect(result.current.preview?.item.title).toBe("Second paper");
});

test("batch imports return persisted identity and resolver metadata, and cancelled downloads never save", async () => {
  const onImportedMetadata = vi.fn();
  const { result } = renderHook(() => useRecommendationLibraryController({ scopeKey: "local", endpoint: "", refreshLocalLibrary: vi.fn(), onSaved: vi.fn(), onImportedMetadata }));
  io.downloadRecommendationPdf.mockResolvedValue({ bytes: new TextEncoder().encode("%PDF-1.7"), contentHash: "hash", metadata: { title: "Resolved paper", authors: ["Ada"] } });
  const imported = await result.current.importPaper({ ...item, title: "doi:10.1234/memory" }, {}, new AbortController().signal);
  expect(imported).toMatchObject({ paperId: "paper", title: "Resolved paper", duplicate: false, filePath: "D:/Library/Download/Paper one.pdf" });
  expect(onImportedMetadata).toHaveBeenCalledWith("paper", expect.objectContaining({ title: "Resolved paper", authors: ["Ada"] }));
  expect(io.persistPdfByteStream.mock.calls[0][0].fileName).toBe("Resolved paper.pdf");
  io.persistPdfByteStream.mockClear();
  const abort = new AbortController();
  io.downloadRecommendationPdf.mockImplementation(async () => { abort.abort(); return { bytes: new Uint8Array(), contentHash: "hash" }; });
  await expect(result.current.importPaper(item, {}, abort.signal)).rejects.toThrow();
  expect(io.persistPdfByteStream).not.toHaveBeenCalled();
});
