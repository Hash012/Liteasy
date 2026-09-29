import { expect, test, vi } from "vitest";
import { createWorkspacePageRestorer } from "../app/controllers/createWorkspacePageRestorer";

test("history rejects deleted resources without navigating and awaits asset loading errors", async () => {
  const input = {
    openAsset: vi.fn(async () => { throw new Error("文件已移除"); }),
    recommendations: [], openRecommendation: vi.fn(), notes: [], selectNote: vi.fn(),
    readingEntries: [], openReading: vi.fn(), hasPaper: () => false, hasPaperResource: () => false,
    openPaper: vi.fn(), openPaperResource: vi.fn(), openDock: vi.fn()
  };
  const restore = createWorkspacePageRestorer(input);
  await expect(restore({ kind: "paper", id: "deleted" })).rejects.toThrow("移出");
  await expect(restore({ kind: "reading", id: "deleted" })).rejects.toThrow("移出");
  await expect(restore({ kind: "recommendation", id: "deleted" })).rejects.toThrow("列表");
  await expect(restore({ kind: "paper-resource", paperId: "deleted", resourceKind: "figures" })).rejects.toThrow("不可用");
  await expect(restore({ kind: "resource", path: "liteasy://objects/deleted" })).rejects.toThrow("文件已移除");
  expect(input.openPaper).not.toHaveBeenCalled();
  expect(input.openReading).not.toHaveBeenCalled();
  expect(input.openRecommendation).not.toHaveBeenCalled();
  expect(input.openPaperResource).not.toHaveBeenCalled();
  expect(input.openDock).not.toHaveBeenCalled();
});
