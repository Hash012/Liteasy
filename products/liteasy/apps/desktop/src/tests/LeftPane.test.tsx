import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { OrganizationSummary } from "../app/features/organization/organization.types";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import type { CloudLibraryTree } from "../app/features/library/cloudLibraryStorageClient";
import type { ArtifactExportRecord } from "../app/features/artifacts/artifactExport.types";
import { LeftPane, type LeftPaneProps } from "../app/layout/LeftPane";

const cloudTrees = vi.hoisted(() => ({
  organization: {
    message: "",
    refresh: vi.fn(async () => undefined),
    status: "ready" as "error" | "idle" | "loading" | "ready",
    trashTree: null,
    tree: null as CloudLibraryTree | null
  },
  user: {
    message: "",
    refresh: vi.fn(async () => undefined),
    status: "ready" as "error" | "idle" | "loading" | "ready",
    trashTree: null,
    tree: null as CloudLibraryTree | null
  }
}));

vi.mock("../app/features/library/useCloudLibraryTree", () => ({
  useCloudLibraryTree: (input: { scopeType: "organization" | "user" }) =>
    cloudTrees[input.scopeType]
}));

const localLibraryClient = vi.hoisted(() => ({
  createFolder: vi.fn(async () => undefined)
}));

vi.mock("../app/features/library/libraryFileSystemClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../app/features/library/libraryFileSystemClient")>(),
  createLocalLibraryFolder: localLibraryClient.createFolder
}));

function organizationSummary(overrides: Partial<OrganizationSummary> = {}): OrganizationSummary {
  return {
    auditEvents: [],
    memberCount: 1,
    members: [],
    myRole: "member",
    name: "研究组织",
    notifications: [],
    organizationId: "org-1",
    policy: { exportPolicy: "all_members", uploadPolicy: "all_members" },
    quota: {
      periodEndsAt: "2026-09-01T00:00:00.000Z",
      storageLimitGb: 100,
      storageUsedGb: 12
    },
    sharedLibrary: {
      documentCount: 0,
      documents: [],
      name: "组织文献库",
      status: "available"
    },
    taskSummary: { failed: 0, running: 0 },
    ...overrides
  };
}

function createProps(overrides: Partial<LeftPaneProps> = {}): LeftPaneProps {
  return {
    accountScopeId: "user-1",
    accountSession: {
      email: "researcher@liteasy.dev",
      expiresAt: "2026-09-01T00:00:00.000Z",
      membershipTier: "pro",
      name: "Researcher",
      sessionId: "session-1",
      userId: "user-1"
    },
    academicProfile: {
      age: "未设置",
      disciplines: [],
      gender: "未设置",
      preferredLanguages: "",
      researchDatasets: "",
      researchMethods: "",
      researchTopics: "",
      stage: "未设置"
    },
    agentMemories: [],
    agentRecentState: "",
    artifactCatalog: [],
    artifactCatalogLoadState: { status: "ready" },
    cloudEndpoint: "http://127.0.0.1:8787",
    documentMetadataSyncMessage: "等待同步。",
    documentMetadataSyncResult: null,
    documentMetadataSyncStatus: "unauthenticated",
    exportRecords: [],
    exportStatus: "ready",
    governanceMessage: "等待组织空间。",
    governanceStatus: "waiting",
    governanceSummary: null,
    importJobs: {},
    leftRailView: "settings",
    list: null,
    listMessage: "",
    listStatus: "idle",
    localLibrarySnapshot: {
      entries: [],
      folders: [],
      libraryId: "library-1",
      revision: 1,
      rootPath: "/home/test/LiteasyLibrary",
      trashEntries: []
    },
    onClearProfile: vi.fn(),
    onClearRecommendations: vi.fn(),
    onDeleteArtifact: vi.fn(async () => ({ message: "已删除", status: "success" as const })),
    onDismissRecommendation: vi.fn(),
    onLoginRequired: vi.fn(),
    onLogout: vi.fn(),
    onOpenAcademicArchive: vi.fn(),
    onOpenArtifact: vi.fn(),
    onOpenExport: vi.fn(async () => undefined),
    onOpenOrganizationDialog: vi.fn(),
    onReturnToLocalWorkspace: vi.fn(),
    onReloadArtifactCatalog: vi.fn(async () => undefined),
    onRemoveExport: vi.fn(async () => undefined),
    onRenameArtifact: vi.fn(async () => ({ message: "已重命名", status: "success" as const })),
    onRefreshExports: vi.fn(async () => undefined),
    onRevealExport: vi.fn(async () => undefined),
    onToggleLock: vi.fn(),
    onToggleProfileSampling: vi.fn(),
    onToggleSelection: vi.fn(),
    onUpdateAcademicProfile: vi.fn(),
    onUpdateAgentMemories: vi.fn(),
    onUpdateAgentRecentState: vi.fn(),
    organizationSummary: null,
    organizationSummaryMessage: "",
    organizationSummaryStatus: "idle",
    papers: [],
    profileReadPaperCount: 0,
    profileSamplingEnabled: false,
    profileTags: [],
    readNotificationIds: [],
    recommendationItems: [],
    recommendationMessage: "暂无关联推荐",
    recommendationPending: false,
    recommendationStatus: "idle",
    selectedPaperIds: [],
    selectionLocked: false,
    settings: createSeededSettingsStore().getState(),
    summary: null,
    workspaceLabel: "本地文献库",
    workspaceSourceType: "local_library",
    ...overrides
  };
}

beforeEach(() => {
  window.localStorage.clear();
  cloudTrees.user.message = "";
  cloudTrees.user.status = "ready";
  cloudTrees.user.tree = null;
  cloudTrees.organization.message = "";
  cloudTrees.organization.status = "ready";
  cloudTrees.organization.tree = null;
  cloudTrees.user.refresh.mockClear();
  cloudTrees.organization.refresh.mockClear();
  localLibraryClient.createFolder.mockClear();
});

describe("LeftPane", () => {
  test("uses task-specific pane headers", () => {
    const { rerender } = render(<LeftPane {...createProps({ leftRailView: "library" })} />);
    expect(screen.getByText("文献库", { selector: ".pane-header" })).toBeInTheDocument();
    rerender(<LeftPane {...createProps({ leftRailView: "organization" })} />);
    expect(screen.getByText("组织", { selector: ".pane-header" })).toBeInTheDocument();
    rerender(<LeftPane {...createProps({ leftRailView: "profile" })} />);
    expect(screen.getByText("个人中心", { selector: ".pane-header" })).toBeInTheDocument();
    rerender(<LeftPane {...createProps({ leftRailView: "settings" })} />);
    expect(screen.getByText("设置", { selector: ".pane-header" })).toBeInTheDocument();
    rerender(<LeftPane {...createProps({ leftRailView: "artifact-library" })} />);
    expect(screen.getByText("产物库", { selector: ".pane-header" })).toBeInTheDocument();
  });

  test("composes saved and exported artifact models and forwards actions", async () => {
    const user = userEvent.setup();
    const onOpenArtifact = vi.fn();
    const onOpenExport = vi.fn(async () => undefined);
    const exportRecord: ArtifactExportRecord = {
      artifactId: "artifact-saved",
      exportedAt: "2026-08-09T03:00:00.000Z",
      fileName: "Saved artifact.md",
      format: "markdown",
      id: "export-1",
      location: "desktop",
      path: "/tmp/Saved artifact.md",
      status: "available",
      title: "Saved artifact"
    };
    render(<LeftPane {...createProps({
      artifactCatalog: [{
        artifactId: "artifact-saved",
        papers: [{ id: "paper-1", title: "Attention Is All You Need" }],
        title: "Saved artifact",
        type: "mindmap"
      }],
      exportRecords: [exportRecord],
      leftRailView: "artifact-library",
      onOpenArtifact,
      onOpenExport
    })} />);

    expect(screen.getByRole("region", { name: "产物库" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开产物：Saved artifact" }));
    expect(onOpenArtifact).toHaveBeenCalledWith("artifact-saved");

    await user.click(screen.getByRole("tab", { name: "已导出" }));
    await user.click(screen.getByRole("button", { name: "打开文件：Saved artifact.md" }));
    expect(onOpenExport).toHaveBeenCalledWith("export-1");
  });

  test("renders four independent resource regions in the designed order", async () => {
    const user = userEvent.setup();
    render(<LeftPane {...createProps({ leftRailView: "library" })} />);
    const regions = screen.getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "本地文献库",
      "收藏",
      "关联推荐",
      "组织文献库"
    ]);

    await user.click(screen.getByRole("button", { name: "收起本地文献库" }));
    expect(screen.getByRole("button", { name: "展开本地文献库" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.getByRole("button", { name: "收起收藏" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: "展开关联推荐" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(within(screen.getByRole("region", { name: "关联推荐" })).queryByText("暂无关联推荐")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开关联推荐" }));
    expect(screen.getByRole("button", { name: "收起关联推荐" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  test("does not expose a standalone selected-paper import action", () => {
    render(<LeftPane {...createProps({ leftRailView: "library" })} />);

    expect(screen.queryByRole("button", { name: "导入选中文献" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "锁定选中文献集" })).toBeInTheDocument();
  });

  test("renders the real local folder hierarchy, PDFs, and metadata-only entries", async () => {
    const user = userEvent.setup();
    render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [
          {
            contentHash: "a".repeat(64),
            id: "paper-1",
            path: "/library/课程/Paper.pdf",
            relativePath: "课程/Paper.pdf",
            title: "Paper"
          },
          {
            contentHash: null,
            id: "metadata-1",
            path: null,
            relativePath: null,
            title: "Metadata Paper"
          }
        ],
        folders: [{ name: "课程", parentPath: null, path: "/library/课程" }],
        libraryId: "library-1",
        revision: 2,
        rootPath: "/library",
        trashEntries: []
      }
    })} />);

    expect(screen.getByRole("button", { name: "展开课程" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开课程" }));
    expect(screen.getByRole("button", { name: "Paper" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "展开仅元数据" }));
    await user.click(screen.getByRole("button", { name: "Metadata Paper" }));
    expect(await screen.findByRole("menuitem", { name: "打开" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByText("仅元数据", { selector: ".library-entry-status" })).toBeInTheDocument();
  });

  test("opens document actions on left click without a persistent trash button", async () => {
    const onOpenPaper = vi.fn();
    render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [{
          contentHash: "c".repeat(64),
          id: "paper-menu",
          path: "/library/Paper.pdf",
          relativePath: "Paper.pdf",
          title: "Paper menu"
        }],
        folders: [],
        libraryId: "library-1",
        revision: 2,
        rootPath: "/library",
        trashEntries: []
      },
      onOpenPaper
    })} />);

    expect(screen.queryByRole("button", { name: "删除 Paper menu" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Paper menu" }));
    expect(await screen.findByRole("menuitem", { name: "移到回收站" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开" })).toBeInTheDocument();
    expect(onOpenPaper).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("menuitem", { name: "打开" }));
    expect(onOpenPaper).toHaveBeenCalledWith("paper-menu");
  });

  test("imports PDFs into the selected local folder and keeps its contents visible", async () => {
    const onAddDroppedPdfFiles = vi.fn(async () => {});
    const onRefreshLocalLibrary = vi.fn(async () => {});
    const initialSnapshot = {
      entries: [],
      folders: [{ name: "课程", parentPath: null, path: "/library/课程" }],
      libraryId: "library-1",
      revision: 2,
      rootPath: "/library",
      trashEntries: []
    };
    const { container, rerender } = render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: initialSnapshot,
      onAddDroppedPdfFiles,
      onRefreshLocalLibrary
    })} />);

    const folderButton = screen.getByRole("button", { name: "课程" });
    await userEvent.click(folderButton);
    expect(folderButton).toHaveAttribute("aria-pressed", "true");
    const disclosure = screen.getByRole("button", { name: "收起课程" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(disclosure);
    expect(screen.getByRole("button", { name: "展开课程" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "导入 PDF" }));
    expect(screen.getByRole("button", { name: "收起课程" })).toHaveAttribute("aria-expanded", "true");

    const input = container.querySelector<HTMLInputElement>(
      'section[aria-label="本地文献库"] input[type="file"][multiple]:not([webkitdirectory])'
    );
    expect(input).not.toBeNull();
    const file = new File(["%PDF-1.7\nbody"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(onAddDroppedPdfFiles).toHaveBeenCalledWith([file], "/library/课程");
    });

    rerender(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        ...initialSnapshot,
        entries: [{
          contentHash: "d".repeat(64),
          id: "paper-imported",
          path: "/library/课程/paper.pdf",
          relativePath: "课程/paper.pdf",
          title: "paper"
        }],
        revision: 3
      },
      onAddDroppedPdfFiles,
      onRefreshLocalLibrary
    })} />);
    const importedPaper = screen.getByRole("button", { name: "paper" });
    expect(importedPaper).toBeVisible();
    expect(importedPaper.closest(".library-paper-row")).toHaveAttribute("data-depth", "1");
    const childList = importedPaper.closest(".library-tree-children");
    expect(childList).not.toBeNull();
    expect(within(childList!.parentElement!).getByRole("button", { name: "课程" })).toBeVisible();
  });

  test("creates a toolbar folder under the selected local folder", async () => {
    render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [],
        folders: [{ name: "课程", parentPath: null, path: "/library/课程" }],
        libraryId: "library-1",
        revision: 2,
        rootPath: "/library",
        trashEntries: []
      }
    })} />);

    const folderButton = screen.getByRole("button", { name: "课程" });
    fireEvent.click(folderButton);
    fireEvent.click(folderButton);
    expect(folderButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "新建本地目录" }));

    const dialog = await screen.findByRole("dialog", { name: "新建目录" });
    expect(dialog).toHaveTextContent("新建子目录");
    const nameInput = within(dialog).getByRole("textbox", { name: "目录名称" });
    fireEvent.change(nameInput, { target: { value: "子目录" } });
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(localLibraryClient.createFolder).toHaveBeenCalledWith("子目录", "/library/课程");
    });
  });

  test("nests Windows extended-path PDFs under their actual folders", async () => {
    const rootPath = "\\\\?\\C:\\Users\\reader\\library";
    const parentPath = `${rootPath}\\课程`;
    const childPath = `${parentPath}\\第一章`;
    render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [{
          contentHash: "e".repeat(64),
          id: "paper-in-child",
          path: `${childPath}\\paper.pdf`,
          relativePath: "课程/第一章/paper.pdf",
          title: "paper-in-child"
        }],
        folders: [
          { name: "课程", parentPath: null, path: parentPath },
          { name: "第一章", parentPath, path: childPath }
        ],
        libraryId: "windows-library",
        revision: 1,
        rootPath,
        trashEntries: []
      }
    })} />);

    await userEvent.click(screen.getByRole("button", { name: "展开课程" }));
    await userEvent.click(screen.getByRole("button", { name: "展开第一章" }));

    const paper = screen.getByRole("button", { name: "paper-in-child" });
    expect(paper.closest(".library-paper-row")).toHaveAttribute("data-depth", "2");
    expect(paper.closest(".library-tree-children")?.parentElement).toContainElement(
      screen.getByRole("button", { name: "第一章" })
    );
  });

  test("imports PDFs into the local library root when no folder is selected", async () => {
    const onAddDroppedPdfFiles = vi.fn(async () => {});
    const { container } = render(<LeftPane {...createProps({
      leftRailView: "library",
      onAddDroppedPdfFiles,
      onRefreshLocalLibrary: vi.fn(async () => {})
    })} />);

    await userEvent.click(screen.getByRole("button", { name: "导入 PDF" }));
    const input = container.querySelector<HTMLInputElement>(
      'section[aria-label="本地文献库"] input[type="file"][multiple]:not([webkitdirectory])'
    );
    const file = new File(["%PDF-1.7\nbody"], "root-paper.pdf", { type: "application/pdf" });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(onAddDroppedPdfFiles).toHaveBeenCalledWith([file], "/home/test/LiteasyLibrary");
    });
  });

  test("lets the user explicitly restore the local library root as the import target", async () => {
    const onAddDroppedPdfFiles = vi.fn(async () => {});
    const { container } = render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [],
        folders: [{ name: "课程", parentPath: null, path: "/library/课程" }],
        libraryId: "library-1",
        revision: 2,
        rootPath: "/library",
        trashEntries: []
      },
      onAddDroppedPdfFiles,
      onRefreshLocalLibrary: vi.fn(async () => undefined)
    })} />);

    await userEvent.click(screen.getByRole("button", { name: "课程" }));
    const rootButton = screen.getByRole("button", { name: "选择本地文献库根目录" });
    await userEvent.click(rootButton);
    expect(rootButton).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "导入 PDF" }));

    const input = container.querySelector<HTMLInputElement>(
      'section[aria-label="本地文献库"] input[type="file"][multiple]:not([webkitdirectory])'
    );
    const file = new File(["%PDF-1.7\nbody"], "root-paper.pdf", { type: "application/pdf" });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(onAddDroppedPdfFiles).toHaveBeenCalledWith([file], "/library");
    });
  });

  test("does not inject fixture nodes into an empty local library", () => {
    render(<LeftPane {...createProps({ leftRailView: "library" })} />);
    expect(screen.getByText("本地文献库为空")).toBeInTheDocument();
    expect(screen.queryByText("My Library")).not.toBeInTheDocument();
    expect(screen.queryByText("Courses")).not.toBeInTheDocument();
    expect(screen.queryByText("Vector Search")).not.toBeInTheDocument();
  });

  test("lets the user choose among legacy libraries from the library error state", async () => {
    const onSelectLegacyLibraryRoot = vi.fn(async () => {});
    render(<LeftPane {...createProps({
      leftRailView: "library",
      loadLegacyLibraryRoots: async () => ["/library/account-a", "/library/account-b"],
      localLibraryError: "检测到多个旧账号本地库，请先选择一个当前库：internal paths",
      localLibrarySnapshot: null,
      onSelectLegacyLibraryRoot
    })} />);

    const candidates = await screen.findByLabelText("检测到的旧文献库");
    expect(candidates).toHaveTextContent("/library/account-a");
    expect(candidates).toHaveTextContent("/library/account-b");
    expect(screen.queryByText(/internal paths/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建本地目录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导入 PDF" })).toBeDisabled();

    await userEvent.click(screen.getAllByRole("button", { name: "设为当前库" })[0]);
    expect(onSelectLegacyLibraryRoot).toHaveBeenCalledWith("/library/account-a");
  });

  test("opens a local PDF without changing a locked selection", async () => {
    const user = userEvent.setup();
    const onOpenPaper = vi.fn();
    const onToggleSelection = vi.fn();
    render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [{
          contentHash: "b".repeat(64),
          id: "paper-1",
          path: "/library/Paper.pdf",
          relativePath: "Paper.pdf",
          title: "Paper"
        }],
        folders: [],
        libraryId: "library-1",
        revision: 2,
        rootPath: "/library",
        trashEntries: []
      },
      onOpenPaper,
      onToggleSelection,
      selectedPaperIds: ["paper-1"],
      selectionLocked: true
    })} />);

    expect(screen.getByRole("checkbox", { name: "选择 Paper" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Paper" }));
    await user.click(await screen.findByRole("menuitem", { name: "打开" }));
    expect(onOpenPaper).toHaveBeenCalledWith("paper-1");
    expect(onToggleSelection).not.toHaveBeenCalled();
  });

  test("shows local trash size and expiry without exposing internal paths", async () => {
    const user = userEvent.setup();
    const purgeAfter = Math.floor(new Date("2026-09-05T00:00:00.000Z").getTime() / 1000);
    render(<LeftPane {...createProps({
      leftRailView: "library",
      localLibrarySnapshot: {
        entries: [],
        folders: [],
        libraryId: "library-1",
        revision: 3,
        rootPath: "/library",
        trashEntries: [{
          byteLength: 2048,
          name: "Removed.pdf",
          nodeType: "document",
          originalRelativePath: "Removed.pdf",
          purgeAfter,
          trashId: "trash-1",
          trashedAt: purgeAfter - 100
        }]
      }
    })} />);

    await user.click(screen.getByRole("button", { name: "回收站" }));
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/到期/)).toBeInTheDocument();
    expect(screen.queryByText("/library/.liteasy/trash")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复 Removed.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "永久删除 Removed.pdf" })).toBeInTheDocument();
  });

  test("keeps the local region usable while cloud regions require login", async () => {
    const user = userEvent.setup();
    const onLoginRequired = vi.fn();
    render(<LeftPane {...createProps({
      accountSession: null,
      leftRailView: "library",
      onLoginRequired
    })} />);

    expect(screen.getByText("本地文献库为空")).toBeInTheDocument();
    const collection = screen.getByRole("region", { name: "收藏" });
    const recommendation = screen.getByRole("region", { name: "关联推荐" });
    const organization = screen.getByRole("region", { name: "组织文献库" });
    expect(within(collection).getByRole("button", { name: "登录" })).toBeInTheDocument();
    await user.click(within(recommendation).getByRole("button", { name: "展开关联推荐" }));
    expect(within(recommendation).getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(within(organization).getByRole("button", { name: "登录" })).toBeInTheDocument();
    await user.click(within(collection).getByRole("button", { name: "登录" }));
    expect(onLoginRequired).toHaveBeenCalledOnce();
  });

  test("shows cloud loading and retry states from the real tree boundary", async () => {
    const user = userEvent.setup();
    cloudTrees.user.status = "error";
    cloudTrees.user.message = "收藏加载失败";
    render(<LeftPane {...createProps({ leftRailView: "library" })} />);
    const collection = screen.getByRole("region", { name: "收藏" });
    expect(within(collection).getByRole("alert")).toHaveTextContent("收藏加载失败");
    await user.click(within(collection).getByRole("button", { name: "重试" }));
    expect(cloudTrees.user.refresh).toHaveBeenCalledOnce();
  });

  test("routes the recommendation bookmark command into the real collection tree", async () => {
    const user = userEvent.setup();
    const onResourceTransfer = vi.fn(async () => undefined);
    cloudTrees.user.tree = {
      entries: [],
      folders: [],
      revision: 3,
          scopeId: "user-1",
      scopeType: "user"
    };
    const recommendation = {
      discoveredAt: "2026-08-07T00:00:00.000Z",
      id: "recommendation-1",
      reason: "Related work",
      relatedDocumentTitle: "Target paper",
      relevanceBand: "high" as const,
      relevanceScore: 0.9,
      source: "Crossref",
      sourceKind: "live" as const,
      sourceUrl: "https://doi.org/10.1000/test",
      title: "Recommended paper"
    };
    render(<LeftPane {...createProps({
      leftRailView: "library",
      onResourceTransfer,
      recommendationItems: [recommendation]
    })} />);

    await user.click(screen.getByRole("button", { name: "展开关联推荐" }));
    await user.click(screen.getByRole("button", { name: "收藏 Recommended paper" }));

    expect(onResourceTransfer).toHaveBeenCalledWith(
      { area: "recommendation", recommendation },
      {
        area: "collection",
        expectedRevision: 3,
        folderId: undefined,
        scope: { scopeId: "user:user-1", scopeType: "user" }
      }
    );
  });

  test("keeps the complete folder subtree in drag data while search filters descendants", async () => {
    const user = userEvent.setup();
    cloudTrees.user.tree = {
      entries: [
        {
          createdAt: "2026-08-11T00:00:00.000Z",
          documentId: "matching-document",
          entryKind: "metadata_only",
          folderId: "reading-folder",
          scopeId: "user:user-1",
          scopeType: "user",
          status: "active",
          title: "Matching paper",
          updatedAt: "2026-08-11T00:00:00.000Z"
        },
        {
          createdAt: "2026-08-11T00:00:00.000Z",
          documentId: "nonmatching-document",
          entryKind: "metadata_only",
          folderId: "reading-folder",
          scopeId: "user:user-1",
          scopeType: "user",
          status: "active",
          title: "Hidden paper",
          updatedAt: "2026-08-11T00:00:00.000Z"
        }
      ],
      folders: [{
        createdAt: "2026-08-11T00:00:00.000Z",
        folderId: "reading-folder",
        name: "Reading",
        status: "active",
        updatedAt: "2026-08-11T00:00:00.000Z"
      }],
      revision: 3,
      scopeId: "user:user-1",
      scopeType: "user"
    };
    render(<LeftPane {...createProps({ leftRailView: "library" })} />);

    await user.type(screen.getByRole("textbox", { name: "搜索文献资源" }), "Matching");
    expect(screen.getByRole("button", { name: "Matching paper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hidden paper" })).not.toBeInTheDocument();

    const setData = vi.fn();
    const folderRow = screen
      .getByRole("button", { name: "Reading" })
      .closest(".library-folder-row");
    expect(folderRow).not.toBeNull();
    fireEvent.dragStart(folderRow!, {
      dataTransfer: { effectAllowed: "", setData }
    });

    const transferCall = setData.mock.calls.find(([type]) =>
      type === "application/x-liteasy-library-resource-v2"
    );
    expect(transferCall).toBeDefined();
    const payload = JSON.parse(transferCall![1]);
    expect(payload.tree.entries.map((entry: { entry: { documentId: string } }) =>
      entry.entry.documentId
    ).sort()).toEqual(["matching-document", "nonmatching-document"]);
  });

  test("forwards explicit negative feedback from a live recommendation", async () => {
    const user = userEvent.setup();
    const onDismissRecommendation = vi.fn();
    const recommendation = {
      discoveredAt: "2026-08-06T00:00:00.000Z",
      id: "recommendation-1",
      reason: "主题相关",
      relatedDocumentTitle: "Source",
      relevanceBand: "high" as const,
      relevanceScore: 0.9,
      source: "OpenAlex",
      sourceKind: "live" as const,
      sourceUrl: "https://openalex.org/W1",
      title: "Candidate Paper"
    };
    render(<LeftPane {...createProps({
      leftRailView: "library",
      onDismissRecommendation,
      recommendationItems: [recommendation],
      recommendationStatus: "ready"
    })} />);

    await user.click(screen.getByRole("button", { name: "展开关联推荐" }));
    await user.click(screen.getByRole("button", { name: "忽略 Candidate Paper" }));
    expect(onDismissRecommendation).toHaveBeenCalledWith(recommendation);
  });

  test("disables organization writes when policy state is unavailable", () => {
    render(<LeftPane {...createProps({
      leftRailView: "library",
      organizationId: "org-1",
      organizationSummary: organizationSummary({ policy: undefined })
    })} />);
    expect(screen.getByRole("button", { name: "新建组织目录" })).toBeDisabled();
  });

  test("renders the settings storage boundary", () => {
    render(<LeftPane {...createProps({
      leftRailView: "settings",
      libraryRootPath: "/library"
    })} />);
    expect(screen.getByLabelText("左边栏设置")).toBeInTheDocument();
    expect(screen.getByLabelText("文献元数据同步")).toBeInTheDocument();
  });

  test("does not expose the personal center while logged out", () => {
    render(<LeftPane {...createProps({ accountSession: null, leftRailView: "profile" })} />);
    expect(screen.queryByLabelText("左边栏个人中心")).not.toBeInTheDocument();
    expect(screen.getByText("未登录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录后查看个人能力" })).toBeInTheDocument();
  });

  test("forwards logout from the authenticated personal center", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(<LeftPane {...createProps({ leftRailView: "profile", onLogout })} />);
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  test("keeps organization management in its dedicated pane", () => {
    render(<LeftPane {...createProps({
      leftRailView: "organization",
      organizationSummary: organizationSummary(),
      summary: organizationSummary()
    })} />);
    expect(screen.getByLabelText("左边栏组织")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回文献库" })).not.toBeInTheDocument();
  });
});
