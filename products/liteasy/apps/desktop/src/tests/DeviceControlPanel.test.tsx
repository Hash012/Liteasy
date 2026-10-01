import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DeviceControlContext, DeviceControlPanel, type DeviceControlModel } from "../app/features/device-control/DeviceControlPanel";
import { emptyDeviceJournal } from "../app/features/device-control/deviceControl.types";

test("pairing requires opt-in and model tasks have separate cost consent", () => {
  const model: DeviceControlModel = { available: true, busy: false, error: "", journal: emptyDeviceJournal(), snapshot: { devices: [], pairs: [], tasks: [] },
    configure: vi.fn(), pair: vi.fn(), unpair: vi.fn(), refresh: vi.fn(), loadResult: vi.fn() };
  render(<DeviceControlContext.Provider value={model}><DeviceControlPanel /></DeviceControlContext.Provider>);
  expect(screen.getByRole("button", { name: "生成手机配对码" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "允许已配对手机发送任务" }));
  expect(model.configure).toHaveBeenLastCalledWith(true, false, "Liteasy 桌面");
  fireEvent.click(screen.getByRole("checkbox", { name: /允许手机发起摘要/ }));
  expect(model.configure).toHaveBeenLastCalledWith(false, true, "Liteasy 桌面");
});
