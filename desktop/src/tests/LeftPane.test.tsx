import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LeftPane, type LeftPaneProps } from "../app/layout/LeftPane";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

function createProps(overrides: Partial<LeftPaneProps> = {}): LeftPaneProps {
  return {
    accountSession: null,
    collectionItems: [],
    documentMetadataSyncMessage: "等待云端账号连接后同步。",
    documentMetadataSyncResult: null,
    documentMetadataSyncStatus: "unauthenticated",
    governanceMessage: "治理状态",
    governanceStatus: "idle",
    governanceSummary: null,
    importJobs: {},
    lastSyncedAt: undefined,
    latestExecutionLabel: undefined,
    leftRailView: "settings",
    list: null,
    listMessage: "组织列表",
    listStatus: "idle",
    onAddExternalPaper: vi.fn(),
    onClearProfile: vi.fn(),
    onClearRecommendations: vi.fn(),
    onCollectRecommendation: vi.fn(),
    onCreateOrganization: vi.fn(),
    onImportSelectedSet: vi.fn(),
    onInviteMember: vi.fn(),
    onJoinOrganization: vi.fn(),
    onLeaveOrganization: vi.fn(),
    onMarkNotificationsRead: vi.fn(),
    onOpenAcademicArchive: vi.fn(),
    onOpenOrganizationDialog: vi.fn(),
    onUpdateAcademicProfile: vi.fn(),
    onOpenSharedLibrary: vi.fn(),
    onReturnToLocalWorkspace: vi.fn(),
    onSelectOrganization: vi.fn(),
    onSetAccessMode: vi.fn(),
    onSyncCloudPolicy: vi.fn(),
    onToggleLocalDirectEnabled: vi.fn(),
    onToggleLock: vi.fn(),
    onToggleProfileSampling: vi.fn(),
    onToggleSelection: vi.fn(),
    organizationSummary: null,
    organizationSummaryMessage: "组织摘要",
    organizationSummaryStatus: "idle",
    papers: [],
    policySyncMessage: "策略",
    policySyncPending: false,
    policySyncStatus: "idle",
    policyVersion: undefined,
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

  test("renders the library view and forwards import action", async () => {
    const user = userEvent.setup();
    const onImportSelectedSet = vi.fn();
    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          onImportSelectedSet,
          papers: [{ id: "demo-1", title: "Attention Is All You Need" }],
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


  test("groups library papers by workspace folders", () => {
    render(
      <LeftPane
        {...createProps({
          leftRailView: "library",
          papers: [
            { id: "demo-1", sourcePath: "fixtures/transformer/attention.pdf", title: "Attention Is All You Need" },
            { id: "demo-2", sourcePath: "fixtures/language-models/bert.pdf", title: "BERT: Pre-training of Deep Bidirectional Transformers" },
            { id: "demo-3", title: "Untitled Local Note" }
          ]
        })}
      />
    );

    const libraryZone = screen.getByLabelText("我的文献库投放区");
    expect(within(libraryZone).getByText("工作区母目录：本地文献库")).toBeInTheDocument();
    expect(within(libraryZone).getByText("目录：fixtures/transformer")).toBeInTheDocument();
    expect(within(libraryZone).getByText("目录：fixtures/language-models")).toBeInTheDocument();
    expect(within(libraryZone).getByText("目录：未归档文献")).toBeInTheDocument();
    expect(within(libraryZone).getAllByText("1 篇文献")).toHaveLength(3);
  });


  test("renders organization action feedback in the organization view", () => {
    render(
      <LeftPane
        {...createProps({
          leftRailView: "organization",
          organizationActionMessage: "已创建 Liteasy Demo Organization 的 demo 组织申请，等待正式后端接入。"
        })}
      />
    );

    const organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByText("组织操作反馈")).toBeInTheDocument();
    expect(within(organizationPane).getByRole("status", { name: "组织操作反馈" })).toHaveTextContent(
      "已创建 Liteasy Demo Organization 的 demo 组织申请，等待正式后端接入。"
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
    expect(within(organizationPane).getByText("共享文献库状态：可打开，会像 VSCode 打开文件夹一样切换当前工作区。")).toBeInTheDocument();
    expect(within(organizationPane).getByRole("button", { name: "打开共享文献库" })).toBeEnabled();
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
    expect(within(organizationPane).getByText("共享文献库状态：同步中，暂时不能打开。请稍后重试。")).toBeInTheDocument();
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
