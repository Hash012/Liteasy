import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AppShell } from "../app/layout/AppShell";

describe("mobile shell", () => {
  it("exposes accessible navigation and selected destination", () => {
    render(<FluentProvider theme={webLightTheme}><AppShell /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "收件箱" }));
    expect(screen.getByRole("button", { name: "收件箱" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeVisible();
  });
});
