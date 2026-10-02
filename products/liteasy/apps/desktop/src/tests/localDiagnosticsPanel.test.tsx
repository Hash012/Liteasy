import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocalDiagnosticsPanel } from "../app/features/local-diagnostics/LocalDiagnosticsPanel";
import { localDiagnostics } from "../app/features/local-diagnostics/localDiagnostics";

beforeEach(() => localDiagnostics.reset());
afterEach(() => { act(() => localDiagnostics.reset()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("only the reviewed snapshot is downloaded after deleting entries and environment", async () => {
  const network = vi.fn(() => { throw new Error("Diagnostics must not send a request"); });
  vi.stubGlobal("fetch", network);
  let downloaded: Blob | undefined;
  const createObjectURL = vi.fn((blob: Blob) => { downloaded = blob; return "blob:synthetic-diagnostics"; });
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const user = userEvent.setup();
  render(<LocalDiagnosticsPanel />);
  await user.click(screen.getByText("本地诊断"));
  await user.click(screen.getByRole("switch", { name: "记录本次窗口的诊断" }));
  await act(async () => {
    await localDiagnostics.measure("choose_file", async () => null);
    await localDiagnostics.measure("read_file", async () => undefined, { format: "epub" });
  });
  await user.click(screen.getByRole("button", { name: "预览诊断包" }));
  await act(async () => { await localDiagnostics.measure("open_reader", async () => undefined); });
  await user.click(screen.getByRole("button", { name: "从诊断包删除第 1 条记录" }));
  await user.click(screen.getByRole("checkbox", { name: "包含应用版本与环境信息" }));
  const preview = (screen.getByRole("textbox", { name: "诊断包 JSON 预览" }) as HTMLTextAreaElement).value;
  expect(JSON.parse(preview)).toEqual({ schema: "liteasy.local-diagnostics/v1", droppedRecords: 0, records: [expect.objectContaining({ sequence: 2, stage: "read_file", format: "epub" })] });
  await user.click(screen.getByRole("button", { name: "导出已预览的诊断包" }));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  const exported = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(downloaded!);
  });
  expect(exported).toBe(preview);
  expect(network).not.toHaveBeenCalled();
});

test("leaving help keeps opt-in active but account reset invalidates the reviewed package", async () => {
  const user = userEvent.setup();
  const first = render(<LocalDiagnosticsPanel />);
  await user.click(screen.getByText("本地诊断"));
  await user.click(screen.getByRole("switch", { name: "记录本次窗口的诊断" }));
  first.unmount();
  await localDiagnostics.measure("read_file", async () => undefined);
  render(<LocalDiagnosticsPanel />);
  await user.click(screen.getByText("本地诊断"));
  expect(screen.getByRole("switch", { name: "记录本次窗口的诊断" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "预览诊断包" }));
  expect((screen.getByRole("textbox", { name: "诊断包 JSON 预览" }) as HTMLTextAreaElement).value).toContain("read_file");
  act(() => localDiagnostics.reset());
  expect(screen.queryByRole("button", { name: "导出已预览的诊断包" })).not.toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "记录本次窗口的诊断" })).not.toBeChecked();
});
