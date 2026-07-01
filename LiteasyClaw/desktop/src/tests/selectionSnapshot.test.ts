import { expect, test } from "vitest";
import { buildSelectedDocumentSetSnapshot } from "../app/features/selection/selectionSnapshot";
import type { WorkspaceState } from "../app/features/workspace/workspace.types";

test("builds a selected document set snapshot in selected paper order", () => {
  const workspaceState: WorkspaceState = {
    papers: [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/papers/attention.pdf",
        title: "Attention Is All You Need"
      },
      {
        id: "paper-2",
        sourcePath: "/tmp/LiteasyLibrary/papers/bert.pdf",
        title: "BERT"
      }
    ],
    selectedPaperIds: ["paper-2", "paper-1"],
    selectionLocked: true,
    workspaceRevision: 7,
    workspaceSource: { rootPath: "/tmp/LiteasyLibrary", type: "local_library" }
  };

  expect(buildSelectedDocumentSetSnapshot(workspaceState)).toEqual({
    documentIds: ["paper-2", "paper-1"],
    documents: [
      { id: "paper-2", sourcePath: "/tmp/LiteasyLibrary/papers/bert.pdf", title: "BERT" },
      { id: "paper-1", sourcePath: "/tmp/LiteasyLibrary/papers/attention.pdf", title: "Attention Is All You Need" }
    ],
    locked: true,
    workspaceRevision: 7,
    workspaceSource: { rootPath: "/tmp/LiteasyLibrary", type: "local_library" }
  });
});

test("preserves selected document ids even when summaries are missing", () => {
  const workspaceState: WorkspaceState = {
    papers: [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/papers/attention.pdf",
        title: "Attention Is All You Need"
      }
    ],
    selectedPaperIds: ["paper-1", "missing-paper"],
    selectionLocked: true,
    workspaceRevision: 8,
    workspaceSource: { rootPath: "/tmp/LiteasyLibrary", type: "local_library" }
  };

  expect(buildSelectedDocumentSetSnapshot(workspaceState)).toEqual({
    documentIds: ["paper-1", "missing-paper"],
    documents: [
      { id: "paper-1", sourcePath: "/tmp/LiteasyLibrary/papers/attention.pdf", title: "Attention Is All You Need" }
    ],
    locked: true,
    workspaceRevision: 8,
    workspaceSource: { rootPath: "/tmp/LiteasyLibrary", type: "local_library" }
  });
});
