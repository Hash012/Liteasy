import { Button, Tooltip } from "@fluentui/react-components";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AdminProvider } from "../App";

test("does not copy the admin layout class onto tooltip portals", async () => {
  const user = userEvent.setup();
  render(
    <AdminProvider>
      <Tooltip content="刷新" relationship="label">
        <Button aria-label="刷新" />
      </Tooltip>
    </AdminProvider>
  );

  await user.hover(screen.getByRole("button", { name: "刷新" }));
  const tooltip = await screen.findByRole("tooltip", { name: "刷新" });
  const portal = tooltip.closest("[data-portal-node='true']");

  expect(portal).toBeInTheDocument();
  expect(portal).not.toHaveClass("admin-provider");
});
