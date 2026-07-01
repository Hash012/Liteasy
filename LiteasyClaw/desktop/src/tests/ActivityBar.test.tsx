import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ActivityBar } from "../app/layout/ActivityBar";

describe("ActivityBar", () => {
  test("renders the VSCode-style left rail and activates the selected view", async () => {
    const onSelectView = vi.fn();
    const onToggleActiveView = vi.fn();
    const user = userEvent.setup();

    render(
      <ActivityBar
        activeView="organization"
        accountSessionAvailable={false}
        onSelectView={onSelectView}
        onToggleActiveView={onToggleActiveView}
      />
    );

    const activityBar = screen.getByLabelText("左边栏导航");
    expect(within(activityBar).getByRole("button", { name: "文献库" })).toBeInTheDocument();
    expect(within(activityBar).getByRole("button", { name: "组织" })).toHaveClass("active");
    const profileButton = within(activityBar).getByRole("button", { name: "个人中心" });
    expect(profileButton).toBeInTheDocument();
    expect(within(profileButton).getByText("未登录")).toBeInTheDocument();
    expect(within(activityBar).getByRole("button", { name: "设置" })).toBeInTheDocument();

    await user.click(within(activityBar).getByRole("button", { name: "设置" }));
    expect(onSelectView).toHaveBeenCalledWith("settings");

    await user.click(within(activityBar).getByRole("button", { name: "组织" }));
    expect(onToggleActiveView).toHaveBeenCalledWith("organization");
  });

  test("hides the profile login badge when a cloud account session exists", () => {
    render(
      <ActivityBar
        activeView="profile"
        accountSessionAvailable={true}
        onSelectView={vi.fn()}
        onToggleActiveView={vi.fn()}
      />
    );

    const profileButton = screen.getByRole("button", { name: "个人中心" });
    expect(profileButton).toHaveClass("active");
    expect(within(profileButton).queryByText("未登录")).not.toBeInTheDocument();
  });
});
