import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ActivityBar } from "../app/layout/ActivityBar";

describe("ActivityBar", () => {
  test("highlights only panels that are actually visible, including panels moved to another region", () => {
    const { rerender } = render(<ActivityBar activeView="library" isViewVisible={() => false} onSelectView={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文献库" })).not.toHaveClass("active");
    expect(screen.getByRole("button", { name: "文献库" })).toHaveAttribute("aria-pressed", "false");
    rerender(<ActivityBar activeView="library" isViewVisible={(view) => view === "settings"} onSelectView={vi.fn()} />);
    expect(screen.getByRole("button", { name: "设置" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "文献库" })).not.toHaveClass("active");
  });
  test("offers independent Agent and help entries after their dock tabs are closed", async () => {
    const user = userEvent.setup();
    const onOpenAgent = vi.fn();
    const onOpenHelp = vi.fn();
    render(<ActivityBar activeView="library" onSelectView={vi.fn()} onOpenAgent={onOpenAgent} onOpenHelp={onOpenHelp} agentOpen={false} helpOpen={false} />);
    const nav = screen.getByRole("navigation", { name: "左边栏导航" });
    await user.click(within(nav).getByRole("button", { name: "Agent", exact: true }));
    expect(onOpenAgent).toHaveBeenCalledOnce();
    await user.click(within(nav).getByRole("button", { name: "帮助", exact: true }));
    expect(onOpenHelp).toHaveBeenCalledOnce();
    expect(within(nav).getByRole("button", { name: "Agent", exact: true })).toHaveAttribute("aria-pressed", "false");
  });
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
    expect(within(activityBar).getByRole("button", { name: "产物库" })).toBeInTheDocument();
    expect(within(activityBar).getByRole("button", { name: "组织" })).toHaveClass("active");
    const profileButton = within(activityBar).getByRole("button", { name: "个人中心" });
    expect(profileButton).toBeInTheDocument();
    expect(within(profileButton).getByText("未登录")).toBeInTheDocument();
    expect(within(activityBar).getByRole("button", { name: "设置" })).toBeInTheDocument();

    await user.click(within(activityBar).getByRole("button", { name: "设置" }));
    expect(onSelectView).toHaveBeenCalledWith("settings");

    await user.click(within(activityBar).getByRole("button", { name: "产物库" }));
    expect(onSelectView).toHaveBeenCalledWith("artifact-library");

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

  test("shows a Fluent tooltip beside an icon-only module entry", async () => {
    const user = userEvent.setup();
    render(
      <ActivityBar
        activeView="library"
        onSelectView={vi.fn()}
      />
    );

    await user.hover(screen.getByRole("button", { name: "文献库" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("文献库");
  });
});
