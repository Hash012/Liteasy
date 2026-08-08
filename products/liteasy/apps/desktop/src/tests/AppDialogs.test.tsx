import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AppDialogs, type AppDialogsProps } from "../app/layout/AppDialogs";
import type { OrganizationSummary } from "../app/features/organization/organization.types";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

const summary: OrganizationSummary = {
  auditEvents: [],
  memberCount: 1,
  members: [{
    id: "member-1", name: "Ada", revision: 0, role: "owner", status: "active", subject: "member-1"
  }],
  myMemberRevision: null,
  myRole: "owner",
  name: "Liteasy AI Reading Lab",
  notifications: [],
  organizationId: "org-demo-1",
  quota: {
    configured: true,
    periodEndsAt: "2026-06-01T00:00:00.000Z",
    storageLimitGb: 100,
    storageUsedGb: 12
  },
  revision: 0,
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
    controlPlaneEndpoint: "http://127.0.0.1:8787",
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
    onSubmitSystemBrowserLogin: vi.fn(),
    onToggleSuppressLoginReminder: vi.fn(),
    onCloseOrganizationDialog: vi.fn(),
    onCreateOrganization: vi.fn(),
    onInviteMember: vi.fn(),
    onJoinOrganization: vi.fn(),
    onLeaveOrganization: vi.fn(),
    onExportProfile: vi.fn(),
    onOpenSharedLibrary: vi.fn(),
    onSelectOrganization: vi.fn(),
    organizationDialogOpen: false,
    summary: null,
    ...overrides
  };
}

describe("AppDialogs", () => {
  test("shows the lightweight login dialog for logged-out startup", async () => {
    const user = userEvent.setup();
    const onSkipLogin = vi.fn();
    const onToggleSuppressLoginReminder = vi.fn();

    render(
      <AppDialogs
        {...createProps({
          loginDialogOpen: true,
          onSkipLogin,
          onToggleSuppressLoginReminder
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "轻量登录面板" });
    expect(within(dialog).getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "跳过，进入本地阅读器" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "不再提醒" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "跳过，进入本地阅读器" }));
    expect(onSkipLogin).toHaveBeenCalledTimes(1);
  });

  test("uses system-browser login without exposing password fields for a production endpoint", async () => {
    const user = userEvent.setup();
    const onSubmitSystemBrowserLogin = vi.fn();
    render(<AppDialogs {...createProps({
      controlPlaneEndpoint: "https://api.liteasy.example",
      loginDialogOpen: true,
      onSubmitSystemBrowserLogin
    })} />);

    const dialog = screen.getByRole("dialog", { name: "轻量登录面板" });
    await user.click(within(dialog).getByRole("button", { name: "使用系统浏览器登录" }));
    expect(onSubmitSystemBrowserLogin).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByLabelText("邮箱")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("密码")).not.toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "清空学术档案确认" })).toHaveClass("workspace-modal-panel");
  });
  test("renders only active profile dialogs and forwards actions", async () => {
    const user = userEvent.setup();
    const onClearProfile = vi.fn();
    const onCloseAcademicArchive = vi.fn();
    const { rerender } = render(
      <AppDialogs {...createProps({ clearProfileConfirmOpen: true, onClearProfile })} />
    );

    await user.click(screen.getByRole("button", { name: "确认清空学术档案" }));
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
          onCloseAcademicArchive
        })}
      />
    );

    expect(screen.getByText("档案所有者：Ada")).toBeInTheDocument();
    expect(screen.getByText("研究学科：未设置")).toBeInTheDocument();
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

    await user.type(screen.getByLabelText("组织名称"), "Liteasy Research Lab");
    await user.click(screen.getByRole("button", { name: "创建组织" }));
    expect(onCreateOrganization).toHaveBeenCalledWith("Liteasy Research Lab");

    rerender(<AppDialogs {...createProps({ joinOrganizationOpen: true, onJoinOrganization })} />);
    await user.type(screen.getByLabelText("邀请令牌"), `orginv_${"a".repeat(43)}`);
    await user.click(screen.getByRole("button", { name: "加入组织" }));
    expect(onJoinOrganization).toHaveBeenCalledWith(`orginv_${"a".repeat(43)}`);

    rerender(<AppDialogs {...createProps({ inviteSummary: summary, onInviteMember })} />);
    expect(screen.getByRole("dialog", { name: "邀请成员确认" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("账号主体 ID"), "user-researcher-1");
    await user.click(screen.getByRole("button", { name: "创建邀请" }));
    expect(onInviteMember).toHaveBeenCalledWith({ role: "member", targetSubject: "user-researcher-1" });

    rerender(<AppDialogs {...createProps({ leaveSummary: summary, onLeaveOrganization })} />);
    expect(screen.getByRole("dialog", { name: "退出组织确认" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "退出组织" }));
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
