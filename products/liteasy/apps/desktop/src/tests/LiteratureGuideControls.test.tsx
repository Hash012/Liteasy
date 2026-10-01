import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useLiteratureGuide } from "../app/features/paper-reading/useLiteratureGuide";
import { LiteratureGuideControls } from "../app/features/paper-reading/LiteratureGuideControls";

test("keeps the reader toolbar compact and configures all annotation options in a dismissible dialog", () => {
  const generate = vi.fn();
  function Harness() {
    const guide = useLiteratureGuide({ scope: "a", title: "Paper", ready: true, count: 2, pageCount: 1, generate,
      readPage: async () => "source", save: async () => 0, clear: async () => {} });
    return <LiteratureGuideControls guide={guide} />;
  }
  render(<Harness />);
  const toolbar = screen.getByRole("group", { name: "文献 AI 标注" });
  expect(within(toolbar).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(within(toolbar).getByRole("button"));
  const dialog = within(screen.getByRole("dialog", { name: "AI 标注", exact: true }));
  expect(dialog.queryByRole("textbox", { name: "本次系统提示词" })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "自定义系统提示词" }));
  fireEvent.change(dialog.getByLabelText("自定义系统提示词"), { target: { value: "我关心推理假设" } });
  expect(dialog.getByLabelText("自定义系统提示词")).toHaveValue("我关心推理假设");
  fireEvent.change(dialog.getByLabelText("已有标注处理方式"), { target: { value: "append" } });
  expect(dialog.getByLabelText("已有标注处理方式")).toHaveValue("append");
  fireEvent.click(dialog.getByRole("button", { name: /讲解重点/ }));
  expect(dialog.getByRole("checkbox", { name: "公式" })).toBeChecked();
  expect(dialog.getByRole("checkbox", { name: "图表与数据" })).toBeChecked();
  for (const checkbox of dialog.getAllByRole("checkbox")) fireEvent.click(checkbox);
  expect(dialog.getByRole("button", { name: "开始标注" })).toBeDisabled();
  fireEvent.click(dialog.getByRole("button", { name: "返回阅读" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});
