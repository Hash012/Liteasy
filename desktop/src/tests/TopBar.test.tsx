import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TopBar } from "../app/layout/TopBar";

describe("TopBar", () => {
  test("renders brand and account actions together", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const onLogout = vi.fn();

    render(
      <TopBar
        accountMessage="当前未登录云账号。联网并登录后，可使用组织、推荐与云端能力；否则将退化为本地阅读器。"
        accountPending={false}
        accountSession={null}
        cloudAvailabilityStatus="available"
        modelAccessMode="cloud_proxy"
        onLogin={onLogin}
        onLogout={onLogout}
      />
    );

    expect(screen.getByText("LiteasyClaw")).toBeInTheDocument();
    expect(screen.getByText(/云端模型能力/)).toBeInTheDocument();
    expect(screen.getByLabelText("云端能力状态：可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录云账号" })).toBeInTheDocument();
    expect(screen.queryByText("当前未登录云账号。联网并登录后，可使用组织、推荐与云端能力；否则将退化为本地阅读器。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录云账号" })).toHaveAttribute(
      "title",
      "当前未登录云账号。联网并登录后，可使用组织、推荐与云端能力；否则将退化为本地阅读器。"
    );

    await user.click(screen.getByRole("button", { name: "登录云账号" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  test("can present a local-reader fallback status when offline", () => {
    render(
      <TopBar
        accountMessage="当前离线，已退化为本地阅读器。联网并登录后，将自动恢复云端能力。"
        accountPending={false}
        accountSession={null}
        cloudAvailabilityStatus="unavailable"
        modelAccessMode="cloud_proxy"
        onLogin={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    expect(screen.getByLabelText("云端能力状态：不可用")).toBeInTheDocument();
    expect(screen.getByLabelText("云端能力状态：不可用")).toHaveAttribute(
      "title",
      "当前离线，已退化为本地阅读器。联网并登录后，将自动恢复云端能力。"
    );
  });
});
