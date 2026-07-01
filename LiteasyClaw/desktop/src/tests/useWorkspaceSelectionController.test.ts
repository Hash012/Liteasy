import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useWorkspaceSelectionController } from "../app/controllers/useWorkspaceSelectionController";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";

test("exposes workspace state and selected document set snapshot", () => {
  const workspaceStore = createWorkspaceStore();
  workspaceStore.openWorkspace(
    [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
        title: "Paper 1"
      }
    ],
    {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  );
  workspaceStore.toggleSelection("paper-1");
  workspaceStore.lockSelection();

  const { result } = renderHook(() =>
    useWorkspaceSelectionController({
      workspaceStore
    })
  );

  expect(result.current.model.selectedDocumentSet).toEqual({
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
    }
  });
});
