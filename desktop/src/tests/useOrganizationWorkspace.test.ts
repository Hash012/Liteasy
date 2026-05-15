import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRef } from "react";
import { useOrganizationWorkspace } from "../app/features/organization/useOrganizationWorkspace";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { OrganizationSharedLibraryManifest, OrganizationSummary } from "../app/features/organization/organization.types";

const starterPapers: Paper[] = [
  {
    id: "demo-1",
    sourcePath: "fixtures/attention-is-all-you-need.pdf",
    title: "Attention Is All You Need"
  },
  {
    id: "demo-2",
    sourcePath: "fixtures/bert-pretraining.pdf",
    title: "BERT: Pre-training of Deep Bidirectional Transformers"
  }
];

const organizationSummary: OrganizationSummary = {
  auditEvents: [],
  memberCount: 12,
  members: [],
  myRole: "研究员",
  name: "Liteasy AI Reading Lab",
  notifications: [],
  organizationId: "org-demo-1",
  quota: {
    periodEndsAt: "2026-06-01T00:00:00Z",
    storageLimitGb: 100,
    storageUsedGb: 38
  },
  sharedLibrary: {
    documentCount: 2,
    documents: [
      {
        id: "org-doc-1",
        sourcePath: "org://org-demo-1/library/rag.pdf",
        title: "Organization Reading List: Retrieval-Augmented Generation"
      },
      {
        id: "org-doc-2",
        sourcePath: "org://org-demo-1/library/long-context.md",
        title: "Team Notes on Long-Context Evaluation"
      }
    ],
    name: "组织共享文献库",
    status: "available"
  },
  taskSummary: {
    failed: 0,
    running: 1
  }
};

const organizationManifest: OrganizationSharedLibraryManifest = {
  documents: [
    {
      folderId: "org-demo-1-rag",
      id: "org-doc-1",
      sourcePath: "org://org-demo-1/shared-library/RAG/org-doc-1.pdf",
      title: "Organization Reading List: Retrieval-Augmented Generation"
    },
    {
      folderId: "org-demo-1-eval",
      id: "org-doc-2",
      sourcePath: "org://org-demo-1/shared-library/Evaluation/org-doc-2.pdf",
      title: "Team Notes on Long-Context Evaluation"
    }
  ],
  folders: [
    {
      id: "org-demo-1-root",
      name: "组织共享文献库",
      parentId: null,
      path: "org://org-demo-1/shared-library"
    },
    {
      id: "org-demo-1-rag",
      name: "RAG",
      parentId: "org-demo-1-root",
      path: "org://org-demo-1/shared-library/RAG"
    },
    {
      id: "org-demo-1-eval",
      name: "Evaluation",
      parentId: "org-demo-1-root",
      path: "org://org-demo-1/shared-library/Evaluation"
    }
  ],
  name: "组织共享文献库",
  organizationId: "org-demo-1",
  rootFolderId: "org-demo-1-root",
  status: "available"
};

type RenderOptions = {
  controlPlaneEndpoint?: string;
  defaultSummary?: OrganizationSummary | null;
  manifestLoader?: (input: { endpoint: string; organizationId: string; sessionId: string }) => Promise<OrganizationSharedLibraryManifest>;
  sessionId?: string;
};

function renderOrganizationWorkspaceHook({
  controlPlaneEndpoint = "http://127.0.0.1:8787",
  defaultSummary = organizationSummary,
  manifestLoader,
  sessionId = "demo-session-1"
}: RenderOptions = {}) {
  const onAnalysisHint = vi.fn();
  const onLeftRailView = vi.fn();
  const onWorkspaceLabel = vi.fn();
  const onWorkspaceSync = vi.fn();

  const hook = renderHook(() => {
    const workspaceStoreRef = useRef(createWorkspaceStore());
    if (workspaceStoreRef.current.getState().papers.length === 0) {
      starterPapers.forEach((paper) => workspaceStoreRef.current.addPaper(paper));
    }

    return {
      actions: useOrganizationWorkspace({
        controlPlaneEndpoint,
        defaultSummary,
        manifestLoader,
        onAnalysisHint,
        onLeftRailView,
        onWorkspaceLabel,
        onWorkspaceSync,
        sessionId,
        starterPapers,
        workspaceStoreRef
      }),
      workspaceStore: workspaceStoreRef.current
    };
  });

  return {
    ...hook,
    onAnalysisHint,
    onLeftRailView,
    onWorkspaceLabel,
    onWorkspaceSync
  };
}

describe("useOrganizationWorkspace", () => {
  test("loads a shared-library manifest before replacing the workspace", async () => {
    const manifestRequests: Array<{ endpoint: string; organizationId: string; sessionId: string }> = [];
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook({
        defaultSummary: {
          ...organizationSummary,
          sharedLibrary: {
            ...organizationSummary.sharedLibrary,
            documents: []
          }
        },
        manifestLoader: async (input) => {
          manifestRequests.push(input);
          return organizationManifest;
        }
      });

    let message = "";
    await act(async () => {
      message = await result.current.actions.openOrganizationSharedLibrary();
    });

    await waitFor(() => {
      expect(onWorkspaceSync).toHaveBeenCalledTimes(1);
    });
    expect(message).toBe("已打开组织共享文献库：组织共享文献库。");
    expect(manifestRequests).toEqual([
      {
        endpoint: "http://127.0.0.1:8787",
        organizationId: "org-demo-1",
        sessionId: "demo-session-1"
      }
    ]);
    expect(result.current.workspaceStore.getState().papers).toEqual([
      {
        id: "org-doc-1",
        sourcePath: "org://org-demo-1/shared-library/RAG/org-doc-1.pdf",
        title: "Organization Reading List: Retrieval-Augmented Generation"
      },
      {
        id: "org-doc-2",
        sourcePath: "org://org-demo-1/shared-library/Evaluation/org-doc-2.pdf",
        title: "Team Notes on Long-Context Evaluation"
      }
    ]);
    expect(onWorkspaceLabel).toHaveBeenCalledWith("组织共享文献库（Liteasy AI Reading Lab）");
    expect(onLeftRailView).toHaveBeenCalledWith("library");
    expect(onAnalysisHint).toHaveBeenCalledWith("已打开组织共享文献库：组织共享文献库。");
  });

  test("opens an organization shared library as a replacement workspace", async () => {
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook();

    let message = "";
    await act(async () => {
      message = await result.current.actions.openOrganizationSharedLibrary();
    });

    expect(message).toBe("已打开组织共享文献库：组织共享文献库。");
    expect(result.current.workspaceStore.getState().papers).toEqual([
      {
        id: "org-doc-1",
        sourcePath: "org://org-demo-1/library/rag.pdf",
        title: "Organization Reading List: Retrieval-Augmented Generation"
      },
      {
        id: "org-doc-2",
        sourcePath: "org://org-demo-1/library/long-context.md",
        title: "Team Notes on Long-Context Evaluation"
      }
    ]);
    expect(onWorkspaceSync).toHaveBeenCalledTimes(1);
    expect(onWorkspaceLabel).toHaveBeenCalledWith("组织共享文献库（Liteasy AI Reading Lab）");
    expect(onLeftRailView).toHaveBeenCalledWith("library");
    expect(onAnalysisHint).toHaveBeenCalledWith("已打开组织共享文献库：组织共享文献库。");
  });

  test("returns to the local starter library workspace", async () => {
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook();

    await act(async () => {
      await result.current.actions.openOrganizationSharedLibrary();
    });

    let message = "";
    act(() => {
      message = result.current.actions.openLocalLibraryWorkspace();
    });

    expect(message).toBe("已返回本地文献库。");
    expect(result.current.workspaceStore.getState().papers).toEqual(starterPapers);
    expect(onWorkspaceSync).toHaveBeenCalledTimes(2);
    expect(onWorkspaceLabel).toHaveBeenLastCalledWith("本地文献库");
    expect(onLeftRailView).toHaveBeenLastCalledWith("library");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("已返回本地文献库。");
  });

  test("does not mutate the workspace when the shared library is unavailable", async () => {
    const unavailableSummary: OrganizationSummary = {
      ...organizationSummary,
      sharedLibrary: {
        ...organizationSummary.sharedLibrary,
        status: "unavailable"
      }
    };
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook({ defaultSummary: unavailableSummary });

    let message = "";
    await act(async () => {
      message = await result.current.actions.openOrganizationSharedLibrary();
    });

    expect(message).toBe("组织共享文献库当前不可用，请稍后在左边栏组织页查看状态。");
    expect(result.current.workspaceStore.getState().papers).toEqual(starterPapers);
    expect(onWorkspaceSync).not.toHaveBeenCalled();
    expect(onWorkspaceLabel).not.toHaveBeenCalled();
    expect(onLeftRailView).not.toHaveBeenCalled();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });

  test("does not mutate the workspace when the shared library has no openable documents", async () => {
    const emptySummary: OrganizationSummary = {
      ...organizationSummary,
      sharedLibrary: {
        ...organizationSummary.sharedLibrary,
        documentCount: 0,
        documents: []
      }
    };
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook({ defaultSummary: emptySummary });

    let message = "";
    await act(async () => {
      message = await result.current.actions.openOrganizationSharedLibrary();
    });

    expect(message).toBe("组织共享文献库尚未下发可打开文献，请稍后在左边栏组织页查看同步状态。");
    expect(result.current.workspaceStore.getState().papers).toEqual(starterPapers);
    expect(onWorkspaceSync).not.toHaveBeenCalled();
    expect(onWorkspaceLabel).not.toHaveBeenCalled();
    expect(onLeftRailView).not.toHaveBeenCalled();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });

  test("does not mutate the workspace when organization summary is missing", async () => {
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook({ defaultSummary: null });

    let message = "";
    await act(async () => {
      message = await result.current.actions.openOrganizationSharedLibrary();
    });

    expect(message).toBe("请先登录云账号，并在左边栏组织页加载组织空间后再打开共享文献库。");
    expect(result.current.workspaceStore.getState().papers).toEqual(starterPapers);
    expect(onWorkspaceSync).not.toHaveBeenCalled();
    expect(onWorkspaceLabel).not.toHaveBeenCalled();
    expect(onLeftRailView).not.toHaveBeenCalled();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });
});
