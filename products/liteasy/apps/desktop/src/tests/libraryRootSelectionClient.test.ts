import { beforeEach, expect, test, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import {
  createLocalLibraryFolder,
  listLegacyLocalLibraryRoots,
  selectLegacyLocalLibraryRoot,
  setLocalLibraryRoot
} from "../app/features/library/libraryFileSystemClient";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

test("uses a dedicated command for the one-time legacy choice", async () => {
  await selectLegacyLocalLibraryRoot("D:/old-account-library");

  expect(invokeMock).toHaveBeenCalledWith("select_legacy_local_library_root", {
    legacyRootPath: "D:/old-account-library"
  });
});

test("preserves a Tauri legacy selection error as an actionable Error", async () => {
  invokeMock.mockRejectedValue("所选旧文献库索引损坏。");

  await expect(selectLegacyLocalLibraryRoot("D:/old-account-library")).rejects.toThrow(
    "所选旧文献库索引损坏。"
  );
});

test("keeps active-library movement separate from legacy selection", async () => {
  await setLocalLibraryRoot("E:/new-empty-library");
  await listLegacyLocalLibraryRoots();

  expect(invokeMock).toHaveBeenNthCalledWith(1, "set_local_library_root", {
    nextRootPath: "E:/new-empty-library"
  });
  expect(invokeMock).toHaveBeenNthCalledWith(2, "list_legacy_local_library_roots");
});

test("preserves a Tauri folder creation error as an Error with its actionable message", async () => {
  invokeMock.mockRejectedValue("当前目录已存在同名资源。");

  await expect(createLocalLibraryFolder("Research")).rejects.toThrow(
    "当前目录已存在同名资源。"
  );
  expect(invokeMock).toHaveBeenCalledWith("create_local_library_folder", {
    name: "Research",
    parentPath: undefined
  });
});
