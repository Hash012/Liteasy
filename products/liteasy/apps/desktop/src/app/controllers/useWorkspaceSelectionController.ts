import { useEffect, useMemo, useState } from "react";
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import { literatureMetadataRepository as defaultLiteratureMetadataRepository } from "../features/paper-identity/literatureMetadataRepository";
import type { LiteratureRecord } from "../features/paper-identity/literature.types";
import { buildSelectedDocumentSetSnapshot } from "../features/selection/selectionSnapshot";
import type { SelectedDocumentSetSnapshot } from "../features/selection/selection.types";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { WorkspaceState } from "../features/workspace/workspace.types";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";

export type WorkspaceSelectionModel = {
  literatureHydration:
    | { status: "idle" | "loading" | "ready" }
    | { issues: Array<{ message: string; paperId: string }>; status: "recoverable_error" };
  selectedDocumentSet: SelectedDocumentSetSnapshot;
  workspaceLabel: string;
  workspaceState: WorkspaceState;
};

export type WorkspaceSelectionActions = {
  setWorkspaceLabel: (workspaceLabel: string) => void;
  setWorkspaceState: (workspaceState: WorkspaceState) => void;
};

type UseWorkspaceSelectionControllerInput = {
  literatureMetadataRepository?: {
    load(paperId: string): Promise<LiteratureRecord | undefined>;
  };
  localLibrarySnapshot?: LocalLibrarySnapshot | null;
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
};

export function useWorkspaceSelectionController({
  literatureMetadataRepository = defaultLiteratureMetadataRepository,
  localLibrarySnapshot,
  workspaceStore
}: UseWorkspaceSelectionControllerInput): {
  actions: WorkspaceSelectionActions;
  model: WorkspaceSelectionModel;
} {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStore.getState())
  );
  const [workspaceLabel, setWorkspaceLabel] = useState("本地文献库");
  const [literatureHydration, setLiteratureHydration] = useState<WorkspaceSelectionModel["literatureHydration"]>({
    status: "idle"
  });
  const localLibraryEntries = localLibrarySnapshot?.entries;
  const localLibraryRootPath = localLibrarySnapshot?.rootPath;
  const localLibrarySnapshotKey = localLibrarySnapshot
    ? [
        localLibrarySnapshot.rootPath,
        ...localLibrarySnapshot.entries.map((entry) => `${entry.id}:${entry.contentHash}:${entry.path}:${entry.title}`)
      ].join("\n")
    : "";
  const selectedDocumentSet = useMemo(
    () => buildSelectedDocumentSetSnapshot(workspaceState),
    [workspaceState]
  );

  useEffect(() => {
    if (!localLibraryRootPath) {
      setLiteratureHydration({ status: "idle" });
      return;
    }

    let cancelled = false;
    const papers = (localLibraryEntries ?? []).map((entry) => ({
      contentHash: entry.contentHash ?? undefined,
      id: entry.id,
      // A bodyless entry has no path to load, so the reader shows "entry only" instead
      // of failing to open a file that was never there.
      sourcePath: entry.path ?? undefined,
      title: entry.title
    }));

    workspaceStore.openWorkspace(papers, {
      rootPath: localLibraryRootPath,
      type: "local_library"
    });
    setWorkspaceState(cloneWorkspaceState(workspaceStore.getState()));
    setWorkspaceLabel(localLibraryRootPath);
    setLiteratureHydration({ status: "loading" });

    void (async () => {
      const loaded: Array<{ literature: LiteratureRecord; paperId: string }> = [];
      const issues: Array<{ message: string; paperId: string }> = [];
      const batchSize = 8;
      for (let offset = 0; offset < papers.length; offset += batchSize) {
        const batch = papers.slice(offset, offset + batchSize);
        const results = await Promise.allSettled(batch.map((paper) =>
          literatureMetadataRepository.load(paper.id)
        ));
        if (cancelled) return;
        results.forEach((result, index) => {
          const paperId = batch[index]!.id;
          if (result.status === "fulfilled") {
            if (result.value) loaded.push({ literature: result.value, paperId });
            return;
          }
          issues.push({
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            paperId
          });
        });
      }
      if (cancelled) return;
      const current = workspaceStore.getState();
      if (current.workspaceSource.type !== "local_library" ||
        current.workspaceSource.rootPath !== localLibraryRootPath) return;
      const literatureByPaperId = new Map(loaded.map((item) => [item.paperId, item.literature]));
      const matchingUpdates = current.papers.flatMap((paper) => {
        const literature = literatureByPaperId.get(paper.id);
        return literature ? [{ ...paper, literature }] : [];
      });
      workspaceStore.updatePapers(matchingUpdates);
      setWorkspaceState(cloneWorkspaceState(workspaceStore.getState()));
      setLiteratureHydration(issues.length > 0
        ? { issues, status: "recoverable_error" }
        : { status: "ready" });
    })();

    return () => {
      cancelled = true;
    };
  }, [localLibrarySnapshotKey, workspaceStore]);

  return {
    actions: {
      setWorkspaceLabel,
      setWorkspaceState
    },
    model: {
      literatureHydration,
      selectedDocumentSet,
      workspaceLabel,
      workspaceState
    }
  };
}
