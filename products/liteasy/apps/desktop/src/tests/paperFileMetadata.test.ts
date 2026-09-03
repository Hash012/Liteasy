import { afterEach, expect, test } from "vitest";
import {
  loadPaperFileMetadata,
  normalizePaperFileMetadata,
  savePaperFileMetadata
} from "../app/features/library/paperFileMetadata";

afterEach(() => {
  window.localStorage.clear();
});

test("normalizes categories and unique file tags within storage limits", () => {
  expect(normalizePaperFileMetadata({
    category: "  机器学习  ",
    tags: [" RAG ", "向量   检索", "RAG", ""]
  })).toEqual({
    category: "机器学习",
    tags: ["RAG", "向量 检索"],
    version: 1
  });
});

test("persists paper file metadata in the browser fallback", async () => {
  await savePaperFileMetadata("paper-metadata", {
    category: "待读",
    tags: ["综述", "数据库"]
  });

  await expect(loadPaperFileMetadata("paper-metadata")).resolves.toEqual({
    category: "待读",
    tags: ["综述", "数据库"],
    version: 1
  });
});
