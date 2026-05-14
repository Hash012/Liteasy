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
    onCollectRecommendation: vi.fn(),
    onCreateOrganization: vi.fn(),
    onImportSelectedSet: vi.fn(),
    onInviteMember: vi.fn(),
    onJoinOrganization: vi.fn(),
    onLeaveOrganization: vi.fn(),
    onMarkNotificationsRead: vi.fn(),
    onOpenAcademicArchive: vi.fn(),
    onOpenOrganizationDialog: vi.fn(),
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

  test("does not render extra return-to-library buttons inside non-library panes", () => {
    const { rerender } = render(<LeftPane {...createProps({ leftRailView: "organization" })} />);

    expect(screen.getByLabelText("左边栏组织")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回文献库" })).not.toBeInTheDocument();

    rerender(<LeftPane {...createProps({ leftRailView: "profile" })} />);
    expect(screen.getByLabelText("左边栏个人中心")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回文献库" })).not.toBeInTheDocument();
  });
});
