import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AppDialogs, type AppDialogsProps } from "../app/layout/AppDialogs";
import type { OrganizationSummary } from "../app/features/organization/organization.types";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

const summary: OrganizationSummary = {
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
    documentCount: 1,
    documents: [{ id: "shared-1", sourcePath: "/tmp/shared.pdf", title: "Shared Paper" }],
    name: "组织共享文献库",
    status: "available"
  },
  taskSummary: { failed: 0, running: 0 }
};

function createProps(overrides: Partial<AppDialogsProps> = {}): AppDialogsProps {
  return {
    academicProfile: defaultAcademicProfile,
    accountSession: null,
    clearProfileConfirmOpen: false,
    academicArchiveOpen: false,
    createOrganizationOpen: false,
    inviteSummary: null,
    joinOrganizationOpen: false,
    leaveSummary: null,
    list: null,
    listMessage: "组织列表待加载。",
    loginDialogOpen: false,
    onCancelClearProfile: vi.fn(),
    onClearProfile: vi.fn(),
    onCloseAcademicArchive: vi.fn(),
    onCloseCreateOrganization: vi.fn(),
    onCloseInviteMember: vi.fn(),
    onCloseJoinOrganization: vi.fn(),
    onCloseLeaveOrganization: vi.fn(),
    onSkipLogin: vi.fn(),
    onSubmitAccountRegistration: vi.fn(),
    onSubmitDemoLogin: vi.fn(),
    onToggleSuppressLoginReminder: vi.fn(),
    onCloseOrganizationDialog: vi.fn(),
    onCreateOrganization: vi.fn(),
    onInviteMember: vi.fn(),
    onJoinOrganization: vi.fn(),
    onLeaveOrganization: vi.fn(),
    onOpenSharedLibrary: vi.fn(),
    onSelectOrganization: vi.fn(),
    organizationDialogOpen: false,
    readPaperCount: 3,
    summary: null,
    ...overrides
  };
}

describe("AppDialogs", () => {
  test("shows the lightweight login dialog for logged-out startup", async () => {
    const user = userEvent.setup();
    const onSkipLogin = vi.fn();
    const onSubmitDemoLogin = vi.fn();
    const onToggleSuppressLoginReminder = vi.fn();

    render(
      <AppDialogs
        {...createProps({
          loginDialogOpen: true,
          onSkipLogin,
          onSubmitDemoLogin,
          onToggleSuppressLoginReminder
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "轻量登录面板" });
    expect(within(dialog).getByRole("button", { name: "一键 Demo 登录" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "跳过，进入本地阅读器" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "不再提醒" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "跳过，进入本地阅读器" }));
    expect(onSkipLogin).toHaveBeenCalledTimes(1);
  });

  test("submits a personal account registration from the lightweight login dialog", async () => {
    const user = userEvent.setup();
    const onSubmitAccountRegistration = vi.fn();

    render(
      <AppDialogs
        {...createProps({
          loginDialogOpen: true,
          onSubmitAccountRegistration
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "轻量登录面板" });
    await user.click(within(dialog).getByRole("button", { name: "创建账号" }));
    await user.type(within(dialog).getByLabelText("昵称"), "Tian");
    await user.type(within(dialog).getByLabelText("邮箱"), "tian@example.com");
    await user.type(
      within(dialog).getByLabelText("密码或密码短语（至少 12 位）"),
      "private-password-1"
    );
    await user.click(within(dialog).getByRole("button", { name: "注册并登录" }));

    expect(onSubmitAccountRegistration).toHaveBeenCalledWith({
      displayName: "Tian",
      email: "tian@example.com",
      password: "private-password-1"
    });
  });

  test("submits an existing account login from the lightweight login dialog", async () => {
    const user = userEvent.setup();
    const onSubmitAccountLogin = vi.fn();

    render(
      <AppDialogs
        {...createProps({
          loginDialogOpen: true,
          onSubmitAccountLogin
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "轻量登录面板" });
    await user.type(within(dialog).getByLabelText("邮箱"), "tian@example.com");
    await user.type(within(dialog).getByLabelText("密码"), "private-password-1");
    await user.click(within(dialog).getByRole("button", { name: "登录" }));

    expect(onSubmitAccountLogin).toHaveBeenCalledWith({
      email: "tian@example.com",
      password: "private-password-1"
    });
  });

  test("renders active dialogs in a workspace-scoped overlay", () => {
    const { rerender } = render(
      <AppDialogs {...createProps({ organizationDialogOpen: true, summary })} />
    );

    expect(screen.getByTestId("workspace-dialog-layer")).toHaveClass("workspace-dialog-layer");
    expect(screen.getByTestId("workspace-dialog-backdrop")).toHaveClass("workspace-dialog-backdrop");
    expect(screen.getByRole("dialog", { name: "组织窗口" })).toHaveClass("workspace-modal-panel");

    rerender(<AppDialogs {...createProps({ academicArchiveOpen: true })} />);
    expect(screen.getByTestId("workspace-dialog-backdrop")).toHaveClass("workspace-dialog-backdrop");
    expect(screen.getByRole("dialog", { name: "学术档案页面" })).toHaveClass("workspace-modal-panel");

    rerender(<AppDialogs {...createProps({ clearProfileConfirmOpen: true })} />);
    expect(screen.getByTestId("workspace-dialog-backdrop")).toHaveClass("workspace-dialog-backdrop");
    expect(screen.getByRole("dialog", { name: "清空用户画像确认" })).toHaveClass("workspace-modal-panel");
  });
  test("renders only active profile dialogs and forwards actions", async () => {
    const user = userEvent.setup();
    const onClearProfile = vi.fn();
    const onCloseAcademicArchive = vi.fn();
    const { rerender } = render(
      <AppDialogs {...createProps({ clearProfileConfirmOpen: true, onClearProfile })} />
    );

    await user.click(screen.getByRole("button", { name: "确认清空用户画像" }));
    expect(onClearProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "学术档案页面" })).not.toBeInTheDocument();

    rerender(
      <AppDialogs
        {...createProps({
          academicArchiveOpen: true,
          accountSession: {
            email: "ada@liteasy.dev",
            expiresAt: "2026-06-01T00:00:00.000Z",
            name: "Ada",
            sessionId: "session-1"
          },
          onCloseAcademicArchive,
          readPaperCount: 7
        })}
      />
    );

    expect(screen.getByText("档案所有者：Ada")).toBeInTheDocument();
    expect(screen.getByText("阅读统计：已阅读 7 篇论文")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onCloseAcademicArchive).toHaveBeenCalledTimes(1);
  });

  test("renders organization action dialogs and forwards productized confirmations", async () => {
    const user = userEvent.setup();
    const onCreateOrganization = vi.fn();
    const onInviteMember = vi.fn();
    const onJoinOrganization = vi.fn();
    const onLeaveOrganization = vi.fn();
    const { rerender } = render(
      <AppDialogs
        {...createProps({ createOrganizationOpen: true, onCreateOrganization })}
      />
    );

    await user.click(screen.getByRole("button", { name: "提交创建组织申请" }));
    expect(onCreateOrganization).toHaveBeenCalledWith("Liteasy Demo Organization");

    rerender(<AppDialogs {...createProps({ joinOrganizationOpen: true, onJoinOrganization })} />);
    await user.click(screen.getByRole("button", { name: "提交加入组织请求" }));
    expect(onJoinOrganization).toHaveBeenCalledWith("LITEASY-DEMO-JOIN");

    rerender(<AppDialogs {...createProps({ inviteSummary: summary, onInviteMember })} />);
    expect(screen.getByRole("dialog", { name: "邀请成员确认" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发送邀请" }));
    expect(onInviteMember).toHaveBeenCalledTimes(1);

    rerender(<AppDialogs {...createProps({ leaveSummary: summary, onLeaveOrganization })} />);
    expect(screen.getByRole("dialog", { name: "退出组织确认" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "提交退出组织请求" }));
    expect(onLeaveOrganization).toHaveBeenCalledTimes(1);
  });

  test("renders organization entry dialog and opens shared library explicitly", async () => {
    const user = userEvent.setup();
    const onOpenSharedLibrary = vi.fn();
    const onSelectOrganization = vi.fn();
    render(
      <AppDialogs
        {...createProps({
          list: {
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 1,
                myRole: "owner",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          },
          onOpenSharedLibrary,
          onSelectOrganization,
          organizationDialogOpen: true,
          summary
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "组织窗口" });
    await user.click(within(dialog).getByRole("button", { name: "打开 Liteasy AI Reading Lab 详情" }));
    expect(onSelectOrganization).toHaveBeenCalledWith("org-demo-1");

    await user.click(within(dialog).getByRole("button", { name: "在工作区打开共享文献库" }));
    expect(onOpenSharedLibrary).toHaveBeenCalledWith(summary);
  });
});
