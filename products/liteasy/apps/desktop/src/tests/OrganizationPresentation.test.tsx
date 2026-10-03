import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { OrganizationSpacePanel } from "../app/features/organization/OrganizationSpacePanel";
import { OrganizationEntryDialog } from "../app/features/organization/OrganizationEntryDialog";
import { organizationUiList as list, organizationUiSummary as summary } from "./fixtures/organizationUiFixtures";

test("switches organizations, opens the shared library and marks scoped notifications read", async () => {
  const user = userEvent.setup();
  const onSelectOrganization = vi.fn(), onOpenSharedLibrary = vi.fn(), onMarkNotificationsRead = vi.fn();
  const props = { list, listMessage: "", listStatus: "success" as const, message: "", summary, status: "success" as const,
    onSelectOrganization, onOpenSharedLibrary, onMarkNotificationsRead, readNotificationIds: ["another:welcome"] };
  const { rerender } = render(<OrganizationSpacePanel {...props} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "切换组织" }), "systems");
  expect(onSelectOrganization).toHaveBeenCalledWith("systems");
  await user.click(screen.getByRole("button", { name: "打开共享文献库" }));
  expect(onOpenSharedLibrary).toHaveBeenCalledWith(summary);
  expect(screen.getByText("2 条未读")).toBeInTheDocument();
  expect(screen.getByText("已读状态仅保存在此设备；标记已读不会处理邀请或任务。")).toBeInTheDocument();
  const notice = screen.getByText(summary.notifications[0].message).closest("li")!;
  await user.click(within(notice).getByRole("button", { name: "标记此通知已读" }));
  expect(onMarkNotificationsRead).toHaveBeenCalledWith({ ...summary, notifications: [summary.notifications[0]] });
  await user.click(screen.getByRole("button", { name: "全部标记已读" }));
  expect(onMarkNotificationsRead).toHaveBeenCalledWith(summary);
  rerender(<OrganizationSpacePanel {...props} readNotificationIds={["research:welcome", "research:papers"]} />);
  expect(screen.getByRole("button", { name: "全部标记已读" })).toBeDisabled();
  rerender(<OrganizationSpacePanel {...props} summary={{ ...summary, sharedLibrary: { ...summary.sharedLibrary, status: "syncing" } }} />);
  expect(screen.getByRole("button", { name: "打开共享文献库" })).toBeDisabled();
});

test("searches organizations and closes the accessible dialog with Escape", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn(), onSelectOrganization = vi.fn();
  render(<OrganizationEntryDialog list={list} listMessage="" summary={summary} onClose={onClose} onSelectOrganization={onSelectOrganization} />);
  const dialog = screen.getByRole("dialog", { name: "组织窗口" });
  await user.type(within(dialog).getByRole("textbox", { name: "搜索组织" }), "数据库");
  expect(within(dialog).queryByRole("button", { name: `打开 ${summary.name} 详情` })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "打开 数据库系统小组 详情" }));
  expect(onSelectOrganization).toHaveBeenCalledWith("systems");
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("same-name organizations retain distinct choices and owner export is narrowly explained", async () => {
  const onSelectOrganization = vi.fn();
  render(<OrganizationSpacePanel list={{ ...list, organizations: list.organizations.map((item) => ({ ...item, name: "同名研究组" })) }}
    listMessage="" listStatus="success" message="" status="success" summary={{ ...summary, accessSnapshot: { allowedActions: ["export_original"], authorizationRevision: 3, policyRevision: 2, policyExceptions: ["owner_export"], denialReasons: { publish_public: "organization_external_sharing_disabled", run_external_model: "organization_external_model_disabled" }, actionConstraints: { inviteRoles: [] } } }} readNotificationIds={[]} onSelectOrganization={onSelectOrganization} />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "切换组织" }), "systems");
  expect(onSelectOrganization).toHaveBeenCalledWith("systems");
  expect(screen.getByRole("option", { name: "同名研究组（systems）" })).toHaveValue("systems");
  expect(screen.getByText(/此例外仅适用于原文件导出，不授予公开发布或外部 AI 使用权限/)).toBeInTheDocument();
});
