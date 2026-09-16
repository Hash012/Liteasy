import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DataLocationSettings } from "../app/features/settings/DataLocationSettings";
const native = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.desktop, invoke: native.invoke }));
beforeEach(() => { native.desktop = true; native.invoke.mockReset(); });

test("keeps the active location until restart and lets users cancel the pending migration", async () => {
  native.invoke.mockImplementation(async (command: string) => command === "choose_data_location"
    ? { currentPath: "C:\\Old", pendingPath: "D:\\LiteasyData" } : { currentPath: "C:\\Old" });
  render(<DataLocationSettings />);
  await waitFor(() => expect(screen.getByLabelText("当前数据保存路径")).toHaveValue("C:\\Old"));
  fireEvent.click(screen.getByRole("button", { name: "选择数据保存位置" }));
  expect(await screen.findByText("D:\\LiteasyData")).toBeInTheDocument();
  expect(screen.getByLabelText("当前数据保存路径")).toHaveValue("C:\\Old");
  expect(native.invoke).not.toHaveBeenCalledWith("restart_for_data_location");
  fireEvent.click(screen.getByRole("button", { name: "取消目录更改" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "重启并迁移数据" })).not.toBeInTheDocument());
  expect(native.invoke).toHaveBeenCalledWith("cancel_data_location_change");
});
test("shows migration failure without claiming the new path is active", async () => {
  native.invoke.mockResolvedValue({ currentPath: "C:\\Old", pendingPath: "D:\\LiteasyData", migrationError: "磁盘空间不足，原数据保留" });
  render(<DataLocationSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘空间不足");
  expect(screen.getByLabelText("当前数据保存路径")).toHaveValue("C:\\Old");
});
test("does not pretend browser storage has a configurable operating-system path", () => {
  native.desktop = false;
  render(<DataLocationSettings />);
  expect(screen.getByText(/浏览器版数据保存在当前浏览器/)).toBeInTheDocument();
  expect(native.invoke).not.toHaveBeenCalled();
});
