import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AccountSettingsView, type AccountControls } from "../app/features/account/AccountSettingsView";

test("guest materials copy only after an explicit account-scoped choice", () => {
  const controls: AccountControls = { account: { scope: "account:one", subject: "user-one", apiBaseUrl: "https://api.example" }, available: true,
    busy: false, error: "", notice: "", guest: false, setGuest: vi.fn(), begin: vi.fn(), cancel: vi.fn(), logout: vi.fn(), copyGuest: vi.fn() };
  render(<AccountSettingsView controls={controls} />);
  expect(controls.copyGuest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "复制本机资料到此账号" }));
  expect(controls.copyGuest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认复制" }));
  expect(controls.copyGuest).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "查看本机资料库" }));
  expect(controls.setGuest).toHaveBeenCalledWith(true);
});
