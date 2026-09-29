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
