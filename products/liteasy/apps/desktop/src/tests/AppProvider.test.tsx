import { Button, Tooltip } from "@fluentui/react-components";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProvider } from "../AppProvider";

test("does not copy the desktop root class onto tooltip portals", async () => {
  const user = userEvent.setup();
  render(
    <AppProvider>
      <Tooltip content="工具" relationship="label">
        <Button aria-label="工具" />
      </Tooltip>
    </AppProvider>
  );

  await user.hover(screen.getByRole("button", { name: "工具" }));
  const tooltip = await screen.findByRole("tooltip", { name: "工具" });
  const portal = tooltip.closest("[data-portal-node='true']");

  expect(portal).toBeInTheDocument();
  expect(portal).not.toHaveClass("fluent-app-root");
});
