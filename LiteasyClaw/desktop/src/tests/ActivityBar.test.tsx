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
        onSelectView={onSelectView}
        onToggleActiveView={onToggleActiveView}
      />
    );

    const activityBar = screen.getByLabelText("左边栏导航");
    expect(within(activityBar).getByRole("button", { name: "文献库" })).toBeInTheDocument();
    expect(within(activityBar).getByRole("button", { name: "组织" })).toHaveClass("active");
    expect(within(activityBar).getByRole("button", { name: "个人中心" })).toBeInTheDocument();
    expect(within(activityBar).getByRole("button", { name: "设置" })).toBeInTheDocument();

    await user.click(within(activityBar).getByRole("button", { name: "设置" }));
    expect(onSelectView).toHaveBeenCalledWith("settings");

    await user.click(within(activityBar).getByRole("button", { name: "组织" }));
    expect(onToggleActiveView).toHaveBeenCalledWith("organization");
  });
});
