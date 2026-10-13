import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ActionChips, GenerationComposer, InlineNotice } from "../app/shared/ui/productPrimitives";

test("changing task chips updates selection without invoking generation", () => {
  const select = vi.fn();
  render(<ActionChips value="explain" onChange={select} items={[{ id: "explain", label: "解释" }, { id: "translate", label: "翻译" }, { id: "unavailable", label: "不可用", disabled: true }]} />);
  expect(screen.getByRole("button", { name: "解释" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "翻译" }));
  expect(select).toHaveBeenCalledExactlyOnceWith("translate");
  fireEvent.click(screen.getByRole("button", { name: "不可用" }));
  expect(select).toHaveBeenCalledTimes(1);
});

test("composer accepts explicit keyboard submit, while IME, ordinary Enter and disabled input do not submit", () => {
  const submit = vi.fn(), change = vi.fn();
  const ui = render(<GenerationComposer value="初稿" onChange={change} onSubmit={submit} />);
  const input = screen.getByRole("textbox", { name: "补充指令（可选）" });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
  fireEvent.keyDown(input, { key: "Enter" }); expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true }); expect(submit).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { value: "修订" } }); expect(change).toHaveBeenCalledWith("修订");
  ui.rerender(<GenerationComposer value="初稿" disabled onChange={change} onSubmit={submit} />);
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); expect(submit).toHaveBeenCalledTimes(2);
});

test("errors announce an alert and ongoing work has textual status independent of its color", () => {
  render(<><InlineNotice intent="error" message="保存失败，结果仍在" /><InlineNotice intent="busy" message="正在准备资料" /></>);
  expect(screen.getByRole("alert")).toHaveTextContent("保存失败，结果仍在");
  expect(screen.getByRole("status")).toHaveTextContent("正在准备资料");
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
});
