import type { MutableRefObject } from "react";
import type { createWorkspaceStore } from "../workspace/workspace.store";
import type { Paper } from "../workspace/workspace.types";
import type { OrganizationSharedLibraryManifest, OrganizationSummary } from "./organization.types";
import { createOrganizationSharedLibraryManifestClient } from "./organizationSharedLibraryManifestClient";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

type SharedLibraryManifestLoaderInput = {
  endpoint: string;
  organizationId: string;
  sessionId: string;
};

type SharedLibraryManifestLoader = (
  input: SharedLibraryManifestLoaderInput
) => Promise<OrganizationSharedLibraryManifest>;

type UseOrganizationWorkspaceOptions = {
  controlPlaneEndpoint: string;
  defaultSummary: OrganizationSummary | null;
  manifestLoader?: SharedLibraryManifestLoader;
  onAnalysisHint: (message: string) => void;
  onLeftRailView: (view: "library") => void;
  onWorkspaceLabel: (label: string) => void;
  onWorkspaceSync: () => void;
  sessionId?: string;
  starterPapers: Paper[];
  workspaceStoreRef: MutableRefObject<WorkspaceStore>;
};

async function loadManifest(input: SharedLibraryManifestLoaderInput) {
  return createOrganizationSharedLibraryManifestClient({ endpoint: input.endpoint })({
    organizationId: input.organizationId,
    sessionId: input.sessionId
  });
}

function getManifestPapers(manifest: OrganizationSharedLibraryManifest): Paper[] {
  return manifest.documents.map((document) => ({
    id: document.id,
    sourcePath: document.sourcePath,
    title: document.title
  }));
}

function getSummaryPapers(summary: OrganizationSummary): Paper[] {
  return summary.sharedLibrary.documents.map((document) => ({
    id: document.id,
    sourcePath: document.sourcePath,
    title: document.title
  }));
}

export function useOrganizationWorkspace({
  controlPlaneEndpoint,
  defaultSummary,
  manifestLoader = loadManifest,
  onAnalysisHint,
  onLeftRailView,
  onWorkspaceLabel,
  onWorkspaceSync,
  sessionId = "anonymous",
  starterPapers,
  workspaceStoreRef
}: UseOrganizationWorkspaceOptions) {
  async function openOrganizationSharedLibrary(summary = defaultSummary) {
    if (!summary) {
      return "请先登录云账号，并在左边栏组织页加载组织空间后再打开共享文献库。";
    }

    if (summary.sharedLibrary.status !== "available") {
      return "组织共享文献库当前不可用，请稍后在左边栏组织页查看状态。";
    }

    if (summary.sharedLibrary.documentCount === 0) {
      return "组织共享文献库尚未下发可打开文献，请稍后在左边栏组织页查看同步状态。";
    }

    let papers = getSummaryPapers(summary);
    let libraryName = summary.sharedLibrary.name;

    if (papers.length === 0) {
      try {
        const manifest = await manifestLoader({
          endpoint: controlPlaneEndpoint,
          organizationId: summary.organizationId,
          sessionId
        });

        if (manifest.status !== "available") {
          return "组织共享文献库当前不可用，请稍后在左边栏组织页查看状态。";
        }

        papers = getManifestPapers(manifest);
        libraryName = manifest.name;
      } catch (error) {
        return error instanceof Error ? error.message : "组织共享文献库目录加载失败。";
      }
    }

    if (papers.length === 0) {
      return "组织共享文献库尚未下发可打开文献，请稍后在左边栏组织页查看同步状态。";
    }

    workspaceStoreRef.current.openWorkspace(papers, {
      rootPath: `org:${summary.organizationId}:${libraryName}`,
      type: "organization_shared"
    });
    onWorkspaceSync();
    onWorkspaceLabel(`${libraryName}（${summary.name}）`);
    onLeftRailView("library");
    const message = `已打开组织共享文献库：${libraryName}。`;
    onAnalysisHint(message);
    return message;
  }

  function openLocalLibraryWorkspace() {
    workspaceStoreRef.current.openWorkspace(starterPapers, {
      rootPath: "本地文献库",
      type: "local_library"
    });
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
