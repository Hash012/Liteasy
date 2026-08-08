import { beforeEach, expect, test, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import {
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

test("keeps active-library movement separate from legacy selection", async () => {
  await setLocalLibraryRoot("E:/new-empty-library");
  await listLegacyLocalLibraryRoots();

  expect(invokeMock).toHaveBeenNthCalledWith(1, "set_local_library_root", {
    nextRootPath: "E:/new-empty-library"
  });
  expect(invokeMock).toHaveBeenNthCalledWith(2, "list_legacy_local_library_roots");
});
