import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DisclosureSection, OptionPicker } from "../app/shared/ui/productPrimitives";
import { SurfaceErrorBoundary } from "../app/shared/ui/SurfaceErrorBoundary";
import { reportSurfaceError, surfaceDiagnostics } from "../app/shared/ui/surfaceDiagnostics";

test("picker submits stable values with duplicate labels, preserves unknown values, and never commits on opening", async () => {
  const change = vi.fn(), user = userEvent.setup();
  const options = [{ value: "", label: "未设置" }, { value: "a", label: "相同名称", description: "第一项" }, { value: "b", label: "相同名称", description: "第二项" }, { value: "disabled", label: "不可用", disabled: true }];
  function Form() { const [value, setValue] = useState("late"); return <form aria-label="配置"><OptionPicker name="scope" aria-label="范围" value={value} options={options} onValueChange={next => { setValue(next); change(next); }} /></form>; }
  render(<Form />);
  expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("scope")).toBe("late");
  await user.click(screen.getByRole("combobox", { name: "范围" })); expect(change).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole("option", { name: /相同名称/ })[1]);
  expect(change).toHaveBeenCalledExactlyOnceWith("b");
  expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("scope")).toBe("b");
  await user.click(screen.getByRole("combobox", { name: "范围" })); await user.click(screen.getByRole("option", { name: "不可用" })); expect(change).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}"); await waitFor(() => expect(screen.getByRole("combobox", { name: "范围" })).toHaveFocus());
});
test("required picker exposes visible validation and disabled values do not submit", () => {
  const ui = render(<form aria-label="配置"><OptionPicker name="status" aria-label="状态" required value="" options={[]} onValueChange={() => {}} /></form>);
  act(() => { expect((screen.getByRole("form") as HTMLFormElement).checkValidity()).toBe(false); });
  expect(screen.getByRole("alert")).toHaveTextContent("请选择");
  expect(screen.getByRole("combobox", { name: "状态" })).toHaveFocus();
  ui.rerender(<form aria-label="配置"><OptionPicker name="status" aria-label="状态" required disabled value="" options={[]} onValueChange={() => {}} /></form>);
  expect((screen.getByRole("form") as HTMLFormElement).checkValidity()).toBe(true);
  expect(new FormData(screen.getByRole("form") as HTMLFormElement).has("status")).toBe(false);
});
test("semantic sections preserve drafts across keyboard collapse", async () => {
  const user = userEvent.setup();
  render(<DisclosureSection title="设置章节"><input aria-label="草稿" defaultValue="初稿" /></DisclosureSection>);
  const button = screen.getByRole("button", { name: "设置章节" }); button.focus();
  await user.keyboard("{Enter}"); expect(button).toHaveAttribute("aria-expanded", "true");
  await user.type(screen.getByRole("textbox", { name: "草稿" }), "保留");
  await user.click(button); await user.keyboard(" ");
  expect(screen.getByRole("textbox", { name: "草稿" })).toHaveValue("初稿保留");
});
test("a broken view can retry without remounting siblings and diagnostics never contain message data", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  let crash = true;
  function Broken() { if (crash) throw new TypeError("secret-token private-paper C:/private/name.pdf"); return <p>已恢复</p>; }
  render(<><SurfaceErrorBoundary surface="artifact-library"><Broken /></SurfaceErrorBoundary><input aria-label="其他草稿" defaultValue="未保存" /></>);
  expect(screen.getByRole("alert")).toHaveTextContent("此面板暂时无法显示");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "仍然保留" } });
  crash = false; await userEvent.click(screen.getByRole("button", { name: "重试面板" }));
  expect(screen.getByText("已恢复")).toBeVisible(); expect(screen.getByRole("textbox")).toHaveValue("仍然保留");
  const error = new Error("secret-token"); reportSurfaceError("fixture", error, "promise"); reportSurfaceError("fixture", error, "promise");
  expect(surfaceDiagnostics().filter(record => record.surface === "fixture")).toHaveLength(1);
  expect(JSON.stringify(surfaceDiagnostics())).not.toMatch(/secret-token|private-paper|private\/name/);
  consoleError.mockRestore();
});


test("async failures notify only their owner on every attempt without exporting custom error names", async () => {
  render(<><section aria-label="第一份文档"><SurfaceErrorBoundary surface="document" instance="one"><p>文档一</p></SurfaceErrorBoundary></section><section aria-label="第二份文档"><SurfaceErrorBoundary surface="document" instance="two"><p>文档二</p></SurfaceErrorBoundary></section></>);
  const error = new Error("private message"); error.name = "synthetic-secret-token";
  act(() => { reportSurfaceError("document", error, "promise", "", "one"); });
  expect(screen.getByRole("region", { name: "第一份文档" })).toHaveTextContent("刚才的操作未完成");
  expect(screen.getByRole("region", { name: "第二份文档" })).not.toHaveTextContent("刚才的操作未完成");
  await userEvent.click(screen.getByRole("button", { name: "知道了" }));
  act(() => { reportSurfaceError("document", error, "promise", "", "one"); });
  expect(screen.getByRole("button", { name: "知道了" })).toBeVisible();
  expect(surfaceDiagnostics().filter(record => record.surface === "document")).toHaveLength(1);
  expect(JSON.stringify(surfaceDiagnostics())).not.toContain("synthetic-secret-token");
});

test("picker keeps exact unresolved identities in form data without exposing them as labels", () => {
  for (const value of ["a03a12f0-99b3-4ee6-bbac-19e675a9a042", "a".repeat(64), JSON.stringify({ objectId: "private-object", revision: "private-revision" })]) {
    const change = vi.fn();
    const view = render(<form aria-label="选择配置"><OptionPicker name="target" aria-label="对象" required value={value} options={[]} onValueChange={change} /></form>);
    const form = screen.getByRole("form", { name: "选择配置" }) as HTMLFormElement;
    expect(screen.getByRole("combobox", { name: "对象" })).toHaveTextContent("正在加载所选项");
    expect(form.textContent).not.toContain(value);
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get("target")).toBe(value);
    view.rerender(<form aria-label="选择配置"><OptionPicker name="target" aria-label="对象" required value={value} options={[{ value, label: "论文讨论" }]} onValueChange={change} /></form>);
    expect(screen.getByRole("combobox", { name: "对象" })).toHaveTextContent("论文讨论");
    expect(change).not.toHaveBeenCalled();
    view.unmount();
  }
});

test("picker distinguishes filtered selections, unavailable objects, failed names, and scope changes", async () => {
  const retry = vi.fn();
  const shared = { value: "private-target", scopeKey: "account-a:org-a", options: [], onValueChange: vi.fn(), "aria-label": "所选对象" };
  const view = render(<OptionPicker {...shared} selectedDisplay={{ value: shared.value, scopeKey: shared.scopeKey, state: "ready", label: "已筛选的论文" }} />);
  expect(screen.getByRole("combobox")).toHaveTextContent("已筛选的论文");
  view.rerender(<OptionPicker {...shared} scopeKey="account-b:org-b" selectedDisplay={{ value: shared.value, scopeKey: shared.scopeKey, state: "ready", label: "已筛选的论文" }} />);
  expect(screen.getByRole("combobox")).not.toHaveTextContent("已筛选的论文");
  expect(screen.getByRole("combobox")).toHaveTextContent("正在加载所选项");
  view.rerender(<OptionPicker {...shared} selectedDisplay={{ value: shared.value, scopeKey: shared.scopeKey, state: "error", onRetry: retry }} />);
  expect(screen.getByRole("combobox")).toHaveTextContent("名称加载失败");
  await userEvent.click(screen.getByRole("button", { name: "重试加载名称" }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(<OptionPicker {...shared} selectedDisplay={{ value: shared.value, scopeKey: shared.scopeKey, state: "unavailable" }} />);
  expect(screen.getByRole("combobox")).toHaveTextContent("所选项已不可用");
  view.rerender(<OptionPicker {...shared} selectedDisplay={{ value: shared.value, scopeKey: shared.scopeKey, state: "unnamed" }} />);
  expect(screen.getByRole("combobox")).toHaveTextContent("未命名项目");
  expect(shared.onValueChange).not.toHaveBeenCalled();
});

test("resolved empty names remain identifiable form values with an explicit unnamed label", async () => {
  const value = "private-unnamed-object";
  const change = vi.fn();
  const shared = { value, scopeKey: "authorized-scope", name: "target", required: true, "aria-label": "对象", onValueChange: change };
  const view = render(<form aria-label="选择配置"><OptionPicker {...shared} options={[{ value, label: "" }]} /></form>);
  const form = screen.getByRole("form", { name: "选择配置" }) as HTMLFormElement;
  expect(screen.getByRole("combobox")).toHaveTextContent("未命名项目");
  expect(screen.getByRole("combobox").closest("[data-selection-state]")).toHaveAttribute("data-selection-state", "unnamed");
  await userEvent.click(screen.getByRole("combobox"));
  expect(screen.getByRole("option", { name: "未命名项目" })).toHaveAttribute("data-option-value", value);
  await userEvent.keyboard("{Escape}");
  view.rerender(<form aria-label="选择配置"><OptionPicker {...shared} options={[]} selectedDisplay={{ value, scopeKey: shared.scopeKey, state: "ready", label: "   " }} /></form>);
  expect(screen.getByRole("combobox")).toHaveTextContent("未命名项目");
  expect(screen.getByRole("combobox").closest("[data-selection-state]")).toHaveAttribute("data-selection-state", "unnamed");
  expect(new FormData(form).get("target")).toBe(value);
  expect(form.checkValidity()).toBe(true);
  expect(form.textContent).not.toContain(value);
  expect(change).not.toHaveBeenCalled();
});
