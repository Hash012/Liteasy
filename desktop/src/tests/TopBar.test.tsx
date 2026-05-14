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
        accountMessage="当前未连接云账号。可先连接开发云会话，再体验同步与推荐功能。"
        accountPending={false}
        accountSession={null}
        modelAccessMode="cloud_proxy"
        onLogin={onLogin}
        onLogout={onLogout}
      />
    );

    expect(screen.getByText("LiteasyClaw")).toBeInTheDocument();
    expect(screen.getByText(/模型：云代理/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接开发云账号" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
