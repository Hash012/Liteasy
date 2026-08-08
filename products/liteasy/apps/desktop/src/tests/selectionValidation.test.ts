import { expect, test } from "vitest";
import { validateSelectedDocumentSet } from "../app/features/selection/selectionValidation";
import type { SelectedDocumentSetSnapshot } from "../app/features/selection/selection.types";

function createSnapshot(overrides: Partial<SelectedDocumentSetSnapshot> = {}): SelectedDocumentSetSnapshot {
  return {
    documentIds: ["paper-1"],
    documents: [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
        title: "Paper 1"
      }
    ],
    locked: true,
    workspaceRevision: 1,
    workspaceSource: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    },
    ...overrides
  };
}

test("requires at least one selected document", () => {
  expect(
    validateSelectedDocumentSet(
      createSnapshot({
        documentIds: [],
        documents: []
      })
    )
  ).toEqual({
    issues: ["selection_empty"],
    ok: false
  });
});

test("requires the selected document set to be locked", () => {
  expect(validateSelectedDocumentSet(createSnapshot({ locked: false }))).toEqual({
    issues: ["selection_unlocked"],
    ok: false
  });
});

test("detects selected ids without document summaries", () => {
  expect(
    validateSelectedDocumentSet(
      createSnapshot({
        documentIds: ["paper-1", "paper-2"],
        documents: [
          {
            id: "paper-1",
            sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
            title: "Paper 1"
          }
        ]
      })
    )
  ).toEqual({
    issues: ["documents_missing"],
    ok: false
  });
});

test("accepts a locked selected document set with document summaries", () => {
  expect(validateSelectedDocumentSet(createSnapshot())).toEqual({ ok: true });
});
