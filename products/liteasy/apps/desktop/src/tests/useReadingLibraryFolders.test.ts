import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useReadingLibraryController } from "../app/controllers/useReadingLibraryController";
import { relativeLibraryFolder } from "../app/features/library/libraryFolderMembership";

function sourceFile(name = "guide.md", contents = "# Field Guide\n\nReading notes.") {
  const file = new File([contents], name);
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(contents).buffer });
  return file;
}
function setup() {
  const input = { scopeId: crypto.randomUUID(), papers: [], enabled: true, localLibraryRootPath: "D:\\Library",
    importPdfs: vi.fn(async () => {}), openPaper: vi.fn(), onOpenReader: vi.fn() };
  return { input, ...renderHook(() => useReadingLibraryController(input)) };
}

test("imports into a folder and persists moves and folder renames without changing asset identity", async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  await act(async () => { await hook.result.current.importFiles([sourceFile()], "D:\\Library\\eBooks\\Topics"); });
  const entry = hook.result.current.entries[0];
  expect(entry).toMatchObject({ format: "markdown", folderPath: "eBooks/Topics" });
  expect(entry.identity).toMatchObject({ key: entry.liteasyPath, locator: entry.liteasyPath, stability: "logical", contentHash: expect.any(String), revision: expect.any(String) });
  await act(async () => { await hook.result.current.updateMetadata(entry.id, { tags: ["经典"], readingStatus: "finished" }); });
  await act(async () => { await hook.result.current.relocateFolder("D:\\Library\\eBooks", "D:\\Library\\Books"); });
  expect(hook.result.current.entries[0]).toMatchObject({ id: entry.id, folderPath: "Books/Topics", tags: ["经典"], liteasyPath: entry.liteasyPath, identity: entry.identity });
  hook.unmount();
  const reopened = renderHook(() => useReadingLibraryController({ ...hook.input, localLibraryRootPath: "E:\\MovedLibrary" }));
  await waitFor(() => expect(reopened.result.current.entries).toHaveLength(1));
  expect(reopened.result.current.entries[0]).toMatchObject({ folderPath: "Books/Topics", readingStatus: "finished" });
  await act(async () => { await reopened.result.current.moveFile(entry.id, "E:\\MovedLibrary"); });
  expect(reopened.result.current.entries[0]).toMatchObject({ folderPath: "", id: entry.id, liteasyPath: entry.liteasyPath });
});

test("reimporting a duplicate into a folder moves it without creating a second object", async () => {
  const hook = setup();
  await act(async () => { await hook.result.current.importFiles([sourceFile()]); });
  await act(async () => { await hook.result.current.importFiles([sourceFile()], "D:\\Library\\eBooks"); });
  expect(hook.result.current.entries).toHaveLength(1);
  expect(hook.result.current.entries[0].folderPath).toBe("eBooks");
  expect(hook.result.current.message).toContain("1 个已有文件已归入目标目录");
});

test("known relative source paths distinguish same-name same-byte files while catalog moves preserve their references", async () => {
  const hook = setup();
  const first = sourceFile(), second = sourceFile();
  Object.defineProperty(first, "webkitRelativePath", { value: "Sources/one/guide.md" });
  Object.defineProperty(second, "webkitRelativePath", { value: "Sources/two/guide.md" });
  await act(async () => { await hook.result.current.importFiles([first, second]); });
  expect(hook.result.current.entries).toHaveLength(2);
  const a = hook.result.current.entries.find((entry) => entry.identity?.sourcePath === "Sources/one/guide.md")!;
  const b = hook.result.current.entries.find((entry) => entry.identity?.sourcePath === "Sources/two/guide.md")!;
  expect(a.identity?.contentHash).toBe(b.identity?.contentHash);
  expect(a.id).not.toBe(b.id);
  expect(a.identity?.key).not.toBe(b.identity?.key);
  await act(async () => { await hook.result.current.importFiles([first], "D:\\Library\\Books"); });
  expect(hook.result.current.entries).toHaveLength(2);
  expect(hook.result.current.entries.find((entry) => entry.id === a.id)).toMatchObject({ folderPath: "Books", identity: a.identity });
  expect(hook.result.current.entries.find((entry) => entry.id === b.id)).toMatchObject({ identity: b.identity });
  expect(hook.result.current.entries.find((entry) => entry.id === b.id)?.folderPath).toBeUndefined();
  hook.unmount();
});

test("opening an unsupported original reports why without downloading or opening a reader", async () => {
  const hook = setup();
  await act(async () => { await hook.result.current.importFiles([sourceFile("measurements.csv", "name,value\nsample,2")]); });
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await act(async () => { hook.result.current.open(hook.result.current.entries[0]); });
    await waitFor(() => expect(hook.result.current.message).toContain("暂不支持内置阅读"));
    expect(hook.input.openPaper).not.toHaveBeenCalled();
    expect(hook.input.onOpenReader).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(hook.result.current.selected?.title).toBe("measurements.csv");
  } finally { download.mockRestore(); hook.unmount(); }
});

test("normalizes Windows display paths and rejects traversal or destinations outside the library", () => {
  expect(relativeLibraryFolder("\\\\?\\D:\\Library", "d:\\Library\\Books")).toBe("Books");
  expect(relativeLibraryFolder("D:\\Library", "D:\\Library")).toBe("");
  expect(() => relativeLibraryFolder("D:\\Library", "D:\\Library-other\\Books")).toThrow("不在");
  expect(() => relativeLibraryFolder("/library", "/library/../outside")).toThrow("无效");
});
