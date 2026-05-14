import type { MutableRefObject } from "react";
import type { createWorkspaceStore } from "../workspace/workspace.store";
import type { Paper } from "../workspace/workspace.types";
import type { OrganizationSummary } from "./organization.types";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

type UseOrganizationWorkspaceOptions = {
  defaultSummary: OrganizationSummary | null;
  onAnalysisHint: (message: string) => void;
  onLeftRailView: (view: "library") => void;
  onWorkspaceLabel: (label: string) => void;
  onWorkspaceSync: () => void;
  starterPapers: Paper[];
  workspaceStoreRef: MutableRefObject<WorkspaceStore>;
};

export function useOrganizationWorkspace({
  defaultSummary,
  onAnalysisHint,
  onLeftRailView,
  onWorkspaceLabel,
  onWorkspaceSync,
  starterPapers,
  workspaceStoreRef
}: UseOrganizationWorkspaceOptions) {
  function openOrganizationSharedLibrary(summary = defaultSummary) {
    if (!summary) {
      return "请先连接云账号并加载组织空间。";
    }

    workspaceStoreRef.current.openWorkspace(
      summary.sharedLibrary.documents.map((document) => ({
        id: document.id,
        sourcePath: document.sourcePath,
        title: document.title
      }))
    );
    onWorkspaceSync();
    onWorkspaceLabel(`${summary.sharedLibrary.name}（${summary.name}）`);
    onLeftRailView("library");
    const message = `已打开组织共享文献库：${summary.sharedLibrary.name}。`;
    onAnalysisHint(message);
    return message;
  }

  function openLocalLibraryWorkspace() {
    workspaceStoreRef.current.openWorkspace(starterPapers);
    onWorkspaceSync();
    onWorkspaceLabel("本地文献库");
    onLeftRailView("library");
    const message = "已返回本地文献库。";
    onAnalysisHint(message);
    return message;
  }

  return {
    openLocalLibraryWorkspace,
    openOrganizationSharedLibrary
  };
}
