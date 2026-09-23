import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { DockLayoutControls } from "../app/layout/DockLayoutControls";

test("highlights the bottom panel only while it is expanded", async () => {
  function Fixture() {
    const [bottom, setBottom] = useState(true);
    return <DockLayoutControls collapsed={{ bottom, left: false, right: true }} onToggleBottom={() => setBottom((value) => !value)} />;
  }
  render(<Fixture />);
  const button = screen.getByRole("button", { name: "展开下栏" });
  expect(button).not.toHaveClass("active");
  expect(button).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(button);
  expect(screen.getByRole("button", { name: "折叠下栏" })).toHaveClass("active");
  expect(button).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(button);
  expect(button).not.toHaveClass("active");
});
