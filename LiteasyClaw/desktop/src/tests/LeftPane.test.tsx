import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LeftPane, type LeftPaneProps } from "../app/layout/LeftPane";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

function createProps(overrides: Partial<LeftPaneProps> = {}): LeftPaneProps {
  return {
    accountSession: {
      email: "researcher@liteasy.dev",
      expiresAt: "2026-05-15T09:30:00Z",
      membershipTier: "pro",
      name: "Liteasy Researcher",
      sessionId: "demo-session-1"
    },
    collectionItems: [],
    collectionMessage: "已同步云端收藏。",
    collectionStatus: "ready",
    documentMetadataSyncMessage: "等待云端账号连接后同步。",
    documentMetadataSyncResult: null,
    documentMetadataSyncStatus: "unauthenticated",
    governanceMessage: "治理状态",
    governanceStatus: "idle",
    governanceSummary: null,
    importJobs: {},
    leftRailView: "settings",
    list: null,
    listMessage: "组织列表",
    listStatus: "idle",
    onAddExternalPaper: vi.fn(),
    onClearProfile: vi.fn(),
    onClearRecommendations: vi.fn(),
    onCollectRecommendation: vi.fn(),
    onRetryCollectionSync: vi.fn(),
    onCreateOrganization: vi.fn(),
    onImportSelectedSet: vi.fn(),
    onInviteMember: vi.fn(),
    onJoinOrganization: vi.fn(),
    onLoginRequired: vi.fn(),
    onLeaveOrganization: vi.fn(),
    onLogout: vi.fn(),
    onMarkNotificationsRead: vi.fn(),
    onOpenAcademicArchive: vi.fn(),
    onOpenOrganizationDialog: vi.fn(),
    onUpdateAcademicProfile: vi.fn(),
    onOpenSharedLibrary: vi.fn(),
    onReturnToLocalWorkspace: vi.fn(),
    onSelectOrganization: vi.fn(),
    onToggleLock: vi.fn(),
    onToggleProfileSampling: vi.fn(),
    onToggleSelection: vi.fn(),
    organizationSummary: null,
    organizationSummaryMessage: "组织摘要",
    organizationSummaryStatus: "idle",
    papers: [],
    profileClearMessage: undefined,
    profileReadPaperCount: 0,
    academicProfile: { age: "未设置", gender: "未设置", stage: "未设置" },
    profileSamplingEnabled: false,
    recommendationItems: [],
    recommendationMessage: "推荐",
    recommendationPending: false,
    recommendationStatus: "idle",
    readNotificationIds: [],
    selectedPaperIds: [],
    selectionLocked: false,
    settings: createSeededSettingsStore().getState(),
    summary: null,
    workspaceLabel: "本地文献库",
    workspaceSourceType: "local_library",
    ...overrides
  };
}

describe("LeftPane", () => {
  test("uses Chinese academic pane headers for activity views", () => {
    const { rerender } = render(<LeftPane {...createProps({ leftRailView: "library" })} />);

    expect(screen.getByText("文献库", { selector: ".pane-header" })).toBeInTheDocument();

    rerender(<LeftPane {...createProps({ leftRailView: "organization" })} />);
    expect(screen.getByText("组织", { selector: ".pane-header" })).toBeInTheDocument();

    rerender(<LeftPane {...createProps({ leftRailView: "profile" })} />);
    expect(screen.getByText("个人中心", { selector: ".pane-header" })).toBeInTheDocument();

    rerender(<LeftPane {...createProps({ leftRailView: "settings" })} />);
    expect(screen.getByText("设置", { selector: ".pane-header" })).toBeInTheDocument();
  });

  test("renders the settings view when selected", () => {
    render(<LeftPane {...createProps({ leftRailView: "settings" })} />);

    expect(screen.getByLabelText("左边栏设置")).toBeInTheDocument();
    expect(screen.getByText("文献元数据同步")).toBeInTheDocument();
  });

  test("shows the local library root and refresh affordance", () => {
    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          workspaceLabel: "/home/test/LiteasyLibrary"
        })}
      />
    );

    expect(screen.getByText("工作区母目录：/home/test/LiteasyLibrary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新本地文献库" })).toBeInTheDocument();
  });

  test("renders the library view and forwards import action", async () => {
    const user = userEvent.setup();
    const onImportSelectedSet = vi.fn();
    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          onImportSelectedSet,
          papers: [{ id: "demo-1", title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" }],
          selectedPaperIds: ["demo-1"],
          selectionLocked: true
        })}
      />
    );

    expect(screen.getByText("我的文献库")).toBeInTheDocument();
    expect(screen.getByText("当前工作区：本地文献库")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "交给AI流程" }));
    expect(onImportSelectedSet).toHaveBeenCalledTimes(1);
  });

  test("switches between local and organization library views from the literature list", async () => {
    const user = userEvent.setup();
    const onReturnToLocalWorkspace = vi.fn();
    const onOpenSharedLibrary = vi.fn();
    const organizationSummary: OrganizationSummary = {
      auditEvents: [],
      memberCount: 12,
      members: [],
      myRole: "member",
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
        documents: [],
        name: "组织共享文献库",
        status: "available"
      },
      taskSummary: { failed: 0, running: 1 }
    };

    const { rerender } = render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          onOpenSharedLibrary,
          onReturnToLocalWorkspace,
          organizationSummary,
          workspaceLabel: "本地文献库",
          workspaceSourceType: "local_library"
        })}
      />
    );

    const localSwitcher = within(screen.getByLabelText("我的文献库投放区")).getByRole("group", {
      name: "文献视图切换"
    });
    expect(within(localSwitcher).getByRole("button", { name: "本地" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(localSwitcher).getByRole("button", { name: "组织" }));
    expect(onOpenSharedLibrary).toHaveBeenCalledWith(organizationSummary);

    rerender(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          onOpenSharedLibrary,
          onReturnToLocalWorkspace,
          organizationSummary,
          workspaceLabel: "组织共享文献库（Liteasy AI Reading Lab）",
          workspaceSourceType: "organization_shared"
        })}
      />
    );

    const organizationSwitcher = within(screen.getByLabelText("我的文献库投放区")).getByRole("group", {
      name: "文献视图切换"
    });
    expect(within(organizationSwitcher).getByRole("button", { name: "组织" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(organizationSwitcher).getByRole("button", { name: "本地" }));
    expect(onReturnToLocalWorkspace).toHaveBeenCalledTimes(1);
  });

  test("renders a Zotero-style collection tree and PDF file drop target", () => {
    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          papers: [
            {
              id: "demo-1",
              sourcePath: "/papers/search/colbert-late-interaction.pdf",
              title:
                "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
            },
            {
              id: "demo-2",
              sourcePath: "/papers/vector-database/survey-vector-database-management-systems.pdf",
              title: "Survey of Vector Database Management Systems"
            },
            {
              id: "demo-3",
              sourcePath: "/papers/vector-search/acorn-vector-search.pdf",
              title:
                "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
            }
          ]
        })}
      />
    );

    const libraryZone = screen.getByLabelText("我的文献库投放区");
    expect(within(libraryZone).getByLabelText("文献库 collections")).toBeInTheDocument();
    expect(within(libraryZone).getByText("My Library")).toBeInTheDocument();
    expect(within(libraryZone).getByText("Courses")).toBeInTheDocument();
    expect(within(libraryZone).getByText("Vector Search")).toBeInTheDocument();
    expect(within(libraryZone).getByLabelText("PDF 文件拖拽导入区")).toHaveTextContent(
      "拖入 PDF 添加到文献库"
    );
    expect(within(libraryZone).getByText(/ColBERT/)).toBeInTheDocument();
    expect(within(libraryZone).getByText("Survey of Vector Database Management Systems")).toBeInTheDocument();
    expect(within(libraryZone).getByText(/ACORN/)).toBeInTheDocument();
    expect(within(libraryZone).getByText(/ColBERT/).closest(".library-item")).toHaveClass(
      "library-item"
    );
  });

  test("switches visible papers when clicking My Library collections", async () => {
    const user = userEvent.setup();

    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          papers: [
            {
              id: "demo-1",
              sourcePath: "/papers/colbert-late-interaction.pdf",
              title:
                "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
            },
            {
              id: "demo-2",
              sourcePath: "/papers/survey-vector-database-management-systems.pdf",
              title: "Survey of Vector Database Management Systems"
            },
            {
              id: "demo-3",
              sourcePath: "/papers/acorn-vector-search.pdf",
              title:
                "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
            }
          ]
        })}
      />
    );

    const libraryZone = screen.getByLabelText("我的文献库投放区");
    expect(within(libraryZone).getByText("当前 Collection：My Library")).toBeInTheDocument();

    await user.click(within(libraryZone).getByRole("button", { name: "Vector Database" }));

    expect(within(libraryZone).getByText("当前 Collection：Vector Database")).toBeInTheDocument();
    expect(within(libraryZone).getByText("Survey of Vector Database Management Systems")).toBeInTheDocument();
    expect(within(libraryZone).queryByText(/ColBERT/)).not.toBeInTheDocument();
    expect(within(libraryZone).queryByText(/ACORN/)).not.toBeInTheDocument();

    await user.click(within(libraryZone).getByRole("button", { name: "My Library" }));

    expect(within(libraryZone).getByText("当前 Collection：My Library")).toBeInTheDocument();
    expect(within(libraryZone).getByText(/ColBERT/)).toBeInTheDocument();
    expect(within(libraryZone).getByText("Survey of Vector Database Management Systems")).toBeInTheDocument();
    expect(within(libraryZone).getByText(/ACORN/)).toBeInTheDocument();
  });

  test("shows collection loading state for logged-in cloud sync", () => {
    render(
      <LeftPane
        {...createProps({
          accountSession: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          },
          collectionMessage: "正在同步云端收藏...",
          collectionStatus: "loading",
          leftRailView: "library"
        })}
      />
    );

    const collectionZone = screen.getByLabelText("收藏投放区");
    expect(within(collectionZone).getByText("正在同步云端收藏...")).toBeInTheDocument();
  });

  test("shows collection retry action when cloud sync fails", async () => {
    const user = userEvent.setup();
    const onRetryCollectionSync = vi.fn();

    render(
      <LeftPane
        {...createProps({
          accountSession: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          },
          collectionMessage: "云端收藏暂时不可用。",
          collectionStatus: "error",
          leftRailView: "library",
          onRetryCollectionSync
        })}
      />
    );

    const collectionZone = screen.getByLabelText("收藏投放区");
    expect(within(collectionZone).getByText("云端收藏暂时不可用。")).toBeInTheDocument();
    await user.click(within(collectionZone).getByRole("button", { name: "重试同步" }));
    expect(onRetryCollectionSync).toHaveBeenCalledTimes(1);
  });


  test("groups library papers by workspace folders", async () => {
    const user = userEvent.setup();

    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          papers: [
            { id: "demo-1", sourcePath: "/papers/colbert-late-interaction.pdf", title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" },
            { id: "demo-2", sourcePath: "/papers/survey-vector-database-management-systems.pdf", title: "Survey of Vector Database Management Systems" },
            { id: "demo-3", title: "Untitled Local Note" }
          ]
        })}
      />
    );

    const libraryZone = screen.getByLabelText("我的文献库投放区");
    await user.click(within(libraryZone).getByRole("button", { name: "My Library" }));

    expect(within(libraryZone).getByText("工作区母目录：本地文献库")).toBeInTheDocument();
    expect(within(libraryZone).getByText("目录：/papers")).toBeInTheDocument();
    expect(within(libraryZone).getByText("目录：未归档文献")).toBeInTheDocument();
    expect(within(libraryZone).getByText("2 篇文献")).toBeInTheDocument();
    expect(within(libraryZone).getByText("1 篇文献")).toBeInTheDocument();
  });


  test("renders organization action feedback in the organization view", () => {
    render(
      <LeftPane
        {...createProps({
          leftRailView: "organization",
          organizationActionMessage: "已提交创建组织“Liteasy Demo Organization”的申请，当前为演示环境记录。"
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByText("组织操作反馈")).toBeInTheDocument();
    expect(within(organizationPane).getByRole("status", { name: "组织操作反馈" })).toHaveTextContent(
      "已提交创建组织“Liteasy Demo Organization”的申请，当前为演示环境记录。"
    );
  });


  test("keeps an available shared library openable when only a manifest count is present", () => {
    const summary = {
      auditEvents: [],
      memberCount: 1,
      members: [],
      myRole: "owner",
      name: "Liteasy AI Reading Lab",
      notifications: [],
      organizationId: "org-demo-1",
      quota: {
        periodEndsAt: "2026-06-01T00:00:00.000Z",
        storageLimitGb: 100,
        storageUsedGb: 12
      },
      sharedLibrary: {
        documentCount: 48,
        documents: [],
        name: "组织共享文献库",
        status: "available" as const
      },
      taskSummary: { failed: 0, running: 1 }
    };

    render(
      <LeftPane
        {...createProps({
          leftRailView: "organization",
          organizationSummaryMessage: "已加载组织空间。",
          organizationSummaryStatus: "success",
          summary
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByRole("button", { name: "打开共享文献库" })).toBeEnabled();
    expect(within(organizationPane).getByRole("button", { name: "打开共享文献库" })).toHaveAttribute(
      "title",
      "共享文献库状态：可打开，会像 VSCode 打开文件夹一样切换当前工作区。"
    );
  });

  test("explains why an organization shared library cannot be opened", () => {
    const summary = {
      auditEvents: [],
      memberCount: 1,
      members: [],
      myRole: "owner",
      name: "Liteasy AI Reading Lab",
      notifications: [],
      organizationId: "org-demo-1",
      quota: {
        periodEndsAt: "2026-06-01T00:00:00.000Z",
        storageLimitGb: 100,
        storageUsedGb: 12
      },
      sharedLibrary: {
        documentCount: 0,
        documents: [],
        name: "组织共享文献库",
        status: "syncing" as const
      },
      taskSummary: { failed: 0, running: 1 }
    };

    render(
      <LeftPane
        {...createProps({
          leftRailView: "organization",
          organizationSummaryMessage: "已加载组织空间。",
          organizationSummaryStatus: "success",
          summary
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByRole("button", { name: "打开共享文献库" })).toBeDisabled();
    expect(within(organizationPane).getByRole("button", { name: "打开共享文献库" })).toHaveAttribute(
      "title",
      "共享文献库状态：同步中，暂时不能打开。请稍后重试。"
    );
  });

  test("renders organization and profile views", () => {
    const summary = {
      auditEvents: [],
      memberCount: 1,
      members: [{ id: "member-1", name: "Ada", role: "owner" }],
      myRole: "owner",
      name: "Liteasy AI Reading Lab",
      notifications: [],
      organizationId: "org-demo-1",
      quota: {
        periodEndsAt: "2026-06-01T00:00:00.000Z",
        storageLimitGb: 100,
        storageUsedGb: 12
      },
      sharedLibrary: {
        documentCount: 0,
        documents: [],
        name: "组织共享文献库",
        status: "available" as const
      },
      taskSummary: { failed: 0, running: 0 }
    };

    const { rerender } = render(
      <LeftPane
        {...createProps({
          leftRailView: "organization",
          organizationSummaryMessage: "已加载组织空间。",
          organizationSummaryStatus: "success",
          summary
        })}
      />
    );
    expect(screen.getByLabelText("左边栏组织")).toBeInTheDocument();
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();

    rerender(
      <LeftPane
        {...createProps({
          accountSession: { avatarUrl: "", name: "Ada", sessionId: "session-1", userId: "user-1" },
          leftRailView: "profile",
          organizationSummary: summary,
          profileSamplingEnabled: true
        })}
      />
    );
    expect(screen.getByLabelText("左边栏个人中心")).toBeInTheDocument();
    expect(screen.getByText("用户画像：已开启")).toBeInTheDocument();
  });

  test("hides organization creation for basic members and keeps join available", () => {
    render(
      <LeftPane
        {...createProps({
          accountSession: {
            email: "reader@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            membershipTier: "basic",
            name: "Liteasy Reader",
            sessionId: "session-basic"
          },
          leftRailView: "organization",
          list: {
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "member",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          },
          listStatus: "success",
          organizationSummaryMessage: "已加载组织空间。",
          organizationSummaryStatus: "success",
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "member",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              storageLimitGb: 100,
              storageUsedGb: 12
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: { failed: 0, running: 1 }
          }
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByRole("button", { name: "创建组织" })).toBeDisabled();
    expect(within(organizationPane).getByRole("button", { name: "加入组织" })).toBeInTheDocument();
    expect(within(organizationPane).getByRole("button", { name: "加入组织" })).toHaveAttribute(
      "title",
      expect.stringContaining("当前账号权限：可加入组织，暂不可创建组织。")
    );
  });

  test("shows organization creation for pro members", () => {
    render(
      <LeftPane
        {...createProps({
          accountSession: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            membershipTier: "pro",
            name: "Liteasy Researcher",
            sessionId: "session-pro"
          },
          leftRailView: "organization",
          list: {
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "member",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          },
          listStatus: "success",
          organizationSummaryMessage: "已加载组织空间。",
          organizationSummaryStatus: "success",
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "member",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              storageLimitGb: 100,
              storageUsedGb: 12
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: { failed: 0, running: 1 }
          }
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByRole("button", { name: "创建组织" })).toBeInTheDocument();
    expect(within(organizationPane).getByRole("button", { name: "创建组织" })).toHaveAttribute(
      "title",
      expect.stringContaining("当前账号权限：可创建组织，也可加入已有组织。")
    );
  });

  test("hides invite-member action when current role lacks invitation permission", () => {
    render(
      <LeftPane
        {...createProps({
          accountSession: {
            email: "reader@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            membershipTier: "pro",
            name: "Liteasy Reader",
            sessionId: "session-pro-reader"
          },
          leftRailView: "organization",
          list: {
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "member",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          },
          listStatus: "success",
          organizationSummaryMessage: "已加载组织空间。",
          organizationSummaryStatus: "success",
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "member",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              storageLimitGb: 100,
              storageUsedGb: 12
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: { failed: 0, running: 1 }
          }
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).queryByRole("button", { name: "邀请成员" })).not.toBeInTheDocument();
  });

  test("shows locked cloud sections in the library view while logged out", () => {
    const onLoginRequired = vi.fn();

    render(
      <LeftPane
        {...createProps({
          accountSession: null,
          leftRailView: "library",
          onLoginRequired,
          recommendationMessage: "当前已退化为本地阅读器，云端推荐不可用。联网并登录后，将自动恢复云端能力。"
        })}
      />
    );

    expect(screen.getByText("收藏")).toBeInTheDocument();
    const loginButtons = screen.getAllByRole("button", { name: "登录后可用" });
    expect(loginButtons.length).toBeGreaterThan(0);
    expect(loginButtons[0]).toHaveAttribute("title", "登录后可用的云端收藏会显示在这里。");
    expect(loginButtons[1]).toHaveAttribute(
      "title",
      "当前已退化为本地阅读器，云端推荐不可用。联网并登录后，将自动恢复云端能力。"
    );
    expect(screen.queryByText("当前已退化为本地阅读器，云端推荐不可用。联网并登录后，将自动恢复云端能力。"))
      .not.toBeInTheDocument();
  });


  test("renders editable academic profile configuration in personal center", async () => {
    const user = userEvent.setup();
    const onUpdateAcademicProfile = vi.fn();

    render(
      <LeftPane
        {...createProps({
          leftRailView: "profile",
          onUpdateAcademicProfile
        })}
      />
    );

    const personalCenter = screen.getByLabelText("左边栏个人中心");
    expect(within(personalCenter).getByText("画像配置：性别 未设置 · 年龄 未设置 · 学段 未设置")).toBeInTheDocument();

    await user.selectOptions(within(personalCenter).getByLabelText("性别"), "女");
    await user.clear(within(personalCenter).getByLabelText("年龄"));
    await user.type(within(personalCenter).getByLabelText("年龄"), "28");
    await user.selectOptions(within(personalCenter).getByLabelText("学段"), "博士研究生");
    await user.click(within(personalCenter).getByRole("button", { name: "保存画像配置" }));

    expect(onUpdateAcademicProfile).toHaveBeenCalledWith({
      age: "28",
      gender: "女",
      stage: "博士研究生"
    });
  });

  test("does not render the editable personal center while logged out", () => {
    render(
      <LeftPane
        {...createProps({
          accountSession: null,
          leftRailView: "profile"
        })}
      />
    );

    expect(screen.queryByLabelText("左边栏个人中心")).not.toBeInTheDocument();
    expect(screen.getByText("未登录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录后查看个人能力" })).toBeInTheDocument();
  });

  test("forwards logout from the logged-in personal center", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();

    render(
      <LeftPane
        {...createProps({
          leftRailView: "profile",
          onLogout
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test("shows governance as waiting instead of disconnected while organization loads", () => {
    render(
      <LeftPane
        {...createProps({
          governanceMessage: "组织空间加载完成后会同步组织治理摘要。",
          governanceStatus: "waiting",
          leftRailView: "organization"
        })}
      />
    );

    expect(screen.getByText("组织治理：等待组织空间")).toBeInTheDocument();
    expect(screen.getByText("组织空间加载完成后会同步组织治理摘要。")).toBeInTheDocument();
  });

  test("does not render extra return-to-library buttons inside non-library panes", () => {
    const { rerender } = render(<LeftPane {...createProps({ leftRailView: "organization" })} />);

    expect(screen.getByLabelText("左边栏组织")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回文献库" })).not.toBeInTheDocument();

    rerender(<LeftPane {...createProps({ leftRailView: "profile" })} />);
    expect(screen.getByLabelText("左边栏个人中心")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回文献库" })).not.toBeInTheDocument();
  });
});
