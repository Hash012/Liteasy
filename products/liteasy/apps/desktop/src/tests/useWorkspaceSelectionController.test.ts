import { renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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
        localLibrarySnapshot: rootPath ? {
          entries: [
            {
              id: "local-paper-1",
              path: `${rootPath}/papers/paper-1.pdf`,
              title: "Paper 1"
            }
          ],
          rootPath
        } : null,
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
    papers: [
      {
        id: "local-paper-1",
        sourcePath: "/tmp/LiteasyLibrary/papers/paper-1.pdf",
        title: "Paper 1"
      }
    ],
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

test("hydrates matching paper literature without blocking missing records", async () => {
  const workspaceStore = createWorkspaceStore();
  const load = vi.fn(async (paperId: string) => paperId === "local-paper-1" ? {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/hydrated" }],
    literatureId: "literature_1",
    provenance: {
      confirmedAt: "2026-08-10T00:00:00.000Z",
      mode: "public_registry" as const,
      provider: "crossref" as const
    },
    title: "Hydrated paper",
    year: 2026
  } : undefined);

  const { result } = renderHook(() => useWorkspaceSelectionController({
    literatureMetadataRepository: { load },
    localLibrarySnapshot: {
      entries: [{ id: "local-paper-1", path: "/library/one.pdf", title: "One" },
        { id: "local-paper-2", path: "/library/two.pdf", title: "Two" }],
      rootPath: "/library"
    },
    workspaceStore
  }));

  await waitFor(() => expect(workspaceStore.getState().papers[0].literature?.literatureId)
    .toBe("literature_1"));
  expect(workspaceStore.getState().papers[1].literature).toBeUndefined();
  expect(result.current.model.literatureHydration).toEqual({ status: "ready" });
  expect(load).toHaveBeenCalledTimes(2);
});

test("surfaces corrupt literature as recoverable and continues hydrating valid papers", async () => {
  const workspaceStore = createWorkspaceStore();
  const load = vi.fn(async (paperId: string) => {
    if (paperId === "corrupt-paper") throw new Error("文献元数据文件不是有效 JSON");
    return {
      authors: [],
      identifiers: [],
      literatureId: "literature_valid",
      provenance: { confirmedAt: "2026-08-10T00:00:00.000Z", mode: "manual" as const },
      title: "Valid paper"
    };
  });

  const { result } = renderHook(() => useWorkspaceSelectionController({
    literatureMetadataRepository: { load },
    localLibrarySnapshot: {
      entries: [{ id: "corrupt-paper", title: "Corrupt" }, { id: "valid-paper", title: "Valid" }],
      rootPath: "/library"
    },
    workspaceStore
  }));

  await waitFor(() => expect(result.current.model.literatureHydration.status)
    .toBe("recoverable_error"));
  expect(result.current.model.literatureHydration).toMatchObject({
    issues: [{ paperId: "corrupt-paper", message: "文献元数据文件不是有效 JSON" }]
  });
  expect(workspaceStore.getState().papers.find((paper) => paper.id === "valid-paper")?.literature)
    .toMatchObject({ literatureId: "literature_valid" });
});

test("does not merge a late literature result into a newly opened library", async () => {
  const workspaceStore = createWorkspaceStore();
  let resolveFirst!: (value: Awaited<ReturnType<typeof load>>) => void;
  const load = vi.fn((paperId: string) => paperId === "old-paper"
    ? new Promise<{
        authors: string[];
        identifiers: [];
        literatureId: string;
        provenance: { confirmedAt: string; mode: "manual" };
        title: string;
      } | undefined>((resolve) => { resolveFirst = resolve; })
    : Promise.resolve(undefined));
  const { rerender } = renderHook(
    ({ paperId, rootPath }: { paperId: string; rootPath: string }) =>
      useWorkspaceSelectionController({
        literatureMetadataRepository: { load },
        localLibrarySnapshot: { entries: [{ id: paperId, title: paperId }], rootPath },
        workspaceStore
      }),
    { initialProps: { paperId: "old-paper", rootPath: "/old" } }
  );

  await waitFor(() => expect(load).toHaveBeenCalledWith("old-paper"));
  rerender({ paperId: "new-paper", rootPath: "/new" });
  resolveFirst({
    authors: [],
    identifiers: [],
    literatureId: "literature_old",
    provenance: { confirmedAt: "2026-08-10T00:00:00.000Z", mode: "manual" },
    title: "Old"
  });

  await waitFor(() => expect(load).toHaveBeenCalledWith("new-paper"));
  expect(workspaceStore.getState().papers).toEqual([
    expect.objectContaining({ id: "new-paper" })
  ]);
  expect(workspaceStore.getState().papers[0]).not.toHaveProperty("literature");
});
