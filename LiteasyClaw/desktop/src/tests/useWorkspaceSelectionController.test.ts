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

test("opens local library snapshots and exposes the workspace label", () => {
  const workspaceStore = createWorkspaceStore();

  const { result, rerender } = renderHook(
    ({ rootPath }: { rootPath?: string }) =>
      useWorkspaceSelectionController({
        localLibrarySnapshot: rootPath ? { documents: [], rootPath } : null,
        workspaceStore
      }),
    {
      initialProps: {}
    }
  );

  expect(result.current.model.workspaceLabel).toBe("本地文献库");

  rerender({ rootPath: "/tmp/LiteasyLibrary" });

  expect(result.current.model.workspaceLabel).toBe("/tmp/LiteasyLibrary");
  expect(result.current.model.workspaceState).toMatchObject({
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false,
    workspaceRevision: 1,
    workspaceSource: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });
  expect(workspaceStore.getState().workspaceSource).toEqual({
    rootPath: "/tmp/LiteasyLibrary",
    type: "local_library"
  });
});
