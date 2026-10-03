import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SpaceOperationsPanel } from "../app/features/spaces/SpaceOperationsPanel";
import { organizationUiSummary } from "./fixtures/organizationUiFixtures";
import type { AccountSession } from "../app/features/account/account.types";
const session: AccountSession = { name: "Synthetic A", email: "a@example.test", sessionId: "synthetic", expiresAt: "2099-01-01", userId: "a" };
test("guest reading offers the actual local library without fetching social state", async () => {
  const refresh = vi.fn(), onOpenLocal = vi.fn();
  render(<SpaceOperationsPanel session={null} workspace="local_library" organization={null} operations={{ rows: [], message: "", busy: false, refresh }} onOpenLocal={onOpenLocal} />);
  await userEvent.click(screen.getByRole("button", { name: "打开本机文库" }));
  expect(onOpenLocal).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "刷新操作记录" })).not.toBeInTheDocument();
});
test("notification reading is separate from task handling and operation recovery opens the real source", async () => {
  const open = vi.fn(), refresh = vi.fn();
  render(<SpaceOperationsPanel session={session} workspace="local_library" organization={organizationUiSummary} readNotificationIds={[`${organizationUiSummary.organizationId}:${organizationUiSummary.notifications[0].id}`]}
    operations={{ rows: [{ id: "unknown", title: "Synthetic annotation", domain: "publication", status: "待核实", audience: "公开", detail: "服务可能已接收原请求", actionLabel: "打开批注核实", open }], busy: false, message: "", refresh }} />);
  const notification = screen.getByText(organizationUiSummary.notifications[0].message).closest("li")!;
  expect(within(notification).getByText("已读")).toBeInTheDocument();
  expect(screen.getByText("已读只表示看过通知；邀请、授权和任务仍需单独处理。")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "打开批注核实" }));
  expect(open).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
});
