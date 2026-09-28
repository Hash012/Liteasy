import { describe, expect, test } from "vitest";
import {
  buildMovedFolderPath,
  buildMovedPaper,
  buildRenamedFolderPath,
  buildRenamedPaper,
  isWorkspacePathWithinRoot,
  joinWorkspacePath,
  replaceWorkspacePathPrefix,
  validateWorkspaceEntryName
} from "../app/features/workspace/workspacePathOperations";

describe("workspacePathOperations", () => {
  test("renames papers without changing their stable id", () => {
    expect(buildRenamedPaper({
      id: "paper-1",
      sourcePath: "/library/search/colbert.pdf",
      title: "ColBERT"
    }, "ColBERT v2.pdf")).toEqual({
      id: "paper-1",
      sourcePath: "/library/search/ColBERT v2.pdf",
      title: "ColBERT v2"
    });
  });

  test("moves files and nested folders with normalized paths", () => {
    expect(buildMovedPaper({
      id: "paper-1",
      sourcePath: "/library/search/colbert.pdf",
      title: "ColBERT"
    }, "/library/archive").sourcePath).toBe("/library/archive/colbert.pdf");
    expect(buildRenamedFolderPath("/library/search", "retrieval"))
      .toBe("/library/retrieval");
    expect(buildMovedFolderPath("/library/search", "/library/archive"))
      .toBe("/library/archive/search");
    expect(replaceWorkspacePathPrefix(
      "/library/search/late/colbert.pdf",
      "/library/search",
      "/library/archive/search"
    )).toBe("/library/archive/search/late/colbert.pdf");
    expect(joinWorkspacePath("", "paper.pdf")).toBe("paper.pdf");
  });

  test("rejects invalid names and moving a folder inside itself", () => {
    expect(() => validateWorkspaceEntryName("../paper")).toThrow();
    expect(() => validateWorkspaceEntryName("a/b")).toThrow();
    expect(() => buildMovedFolderPath("/library/search", "/library/search/child"))
      .toThrow("不能把目录移动到自身或其子目录中");
  });

  test("recognizes paths only inside an absolute workspace root", () => {
    expect(isWorkspacePathWithinRoot("/library/papers/a.pdf", "/library")).toBe(true);
    expect(isWorkspacePathWithinRoot("/library-copy/a.pdf", "/library")).toBe(false);
    expect(isWorkspacePathWithinRoot("fixtures/a.pdf", "fixtures")).toBe(false);
  });
});

test("matches Windows native, forward, extended and differently cased paths", () => {
  const root = String.raw`\\?\D:\TJM\LiteasyData\library`;
  expect(isWorkspacePathWithinRoot("d:/tjm/LiteasyData/library/paper.pdf", root)).toBe(true);
  expect(isWorkspacePathWithinRoot("//?/D:/TJM/LiteasyData/library/trial/paper.pdf", root)).toBe(true);
  expect(isWorkspacePathWithinRoot("D:/TJM/LiteasyData/library-copy/paper.pdf", root)).toBe(false);
  expect(buildMovedPaper({ id: "p", title: "P", sourcePath: `${root}\\paper.pdf` }, `${root}\\trial`).sourcePath)
    .toBe("D:/TJM/LiteasyData/library/trial/paper.pdf");
  expect(replaceWorkspacePathPrefix("d:/tjm/liteasydata/library/trial/paper.pdf", `${root}\\Trial`, `${root}\\Archive`))
    .toBe("D:/TJM/LiteasyData/library/Archive/paper.pdf");
  expect(() => buildMovedFolderPath(`${root}\\Trial`, "d:/tjm/liteasydata/library/trial/nested")).toThrow();
  expect(isWorkspacePathWithinRoot(String.raw`\\server\share\library\paper.pdf`, String.raw`\\?\UNC\server\share\library`)).toBe(true);
});
