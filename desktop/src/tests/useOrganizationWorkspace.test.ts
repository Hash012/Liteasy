import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRef } from "react";
import { useOrganizationWorkspace } from "../app/features/organization/useOrganizationWorkspace";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

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

function renderOrganizationWorkspaceHook(defaultSummary: OrganizationSummary | null = organizationSummary) {
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
        defaultSummary,
        onAnalysisHint,
        onLeftRailView,
        onWorkspaceLabel,
        onWorkspaceSync,
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
  test("opens an organization shared library as a replacement workspace", () => {
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook();

    let message = "";
    act(() => {
      message = result.current.actions.openOrganizationSharedLibrary();
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

  test("returns to the local starter library workspace", () => {
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook();

    act(() => {
      result.current.actions.openOrganizationSharedLibrary();
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

  test("does not mutate the workspace when organization summary is missing", () => {
    const { onAnalysisHint, onLeftRailView, onWorkspaceLabel, onWorkspaceSync, result } =
      renderOrganizationWorkspaceHook(null);

    let message = "";
    act(() => {
      message = result.current.actions.openOrganizationSharedLibrary();
    });

    expect(message).toBe("请先连接云账号并加载组织空间。");
    expect(result.current.workspaceStore.getState().papers).toEqual(starterPapers);
    expect(onWorkspaceSync).not.toHaveBeenCalled();
    expect(onWorkspaceLabel).not.toHaveBeenCalled();
    expect(onLeftRailView).not.toHaveBeenCalled();
    expect(onAnalysisHint).not.toHaveBeenCalled();
  });
});
