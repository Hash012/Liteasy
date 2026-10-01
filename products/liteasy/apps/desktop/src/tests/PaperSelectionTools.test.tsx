import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PaperSelectionTools } from "../app/features/pdf/PaperSelectionTools";

test("preserves selection actions and board dragging with named color choices", async () => {
  const actions = { highlight: vi.fn(), underline: vi.fn(), copy: vi.fn(), lookup: vi.fn(), board: vi.fn(), tray: vi.fn(), quickAsk: vi.fn(), conversation: vi.fn(), dragBoard: vi.fn(), onColorChange: vi.fn() };
  render(<PaperSelectionTools {...actions} color="yellow" />);
  const tools = screen.getByRole("toolbar", { name: "选段工具" });
  expect(within(tools).getByRole("button", { name: "选择黄色高亮" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(within(tools).getByRole("button", { name: "选择蓝色高亮" }));
  expect(actions.onColorChange).toHaveBeenCalledWith("blue");
  for (const [label, action] of [
    ["高亮", actions.highlight], ["划线", actions.underline], ["复制", actions.copy], ["查词/翻译", actions.lookup],
    ["加入白板", actions.board], ["加入摘录对话", actions.tray], ["速问", actions.quickAsk], ["加入对话", actions.conversation]
  ] as const) {
    await userEvent.click(within(tools).getByRole("button", { name: label, exact: true }));
    expect(action).toHaveBeenCalledTimes(1);
  }
  fireEvent.dragStart(within(tools).getByRole("button", { name: "加入白板", exact: true }));
  expect(actions.dragBoard).toHaveBeenCalledTimes(1);
});
