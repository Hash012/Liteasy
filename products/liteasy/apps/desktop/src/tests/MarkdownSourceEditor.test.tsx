import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MarkdownSourceEditor } from "../app/features/markdown/MarkdownSourceEditor";

function Editor() {
  const [value, setValue] = useState("研究结论");
  return <MarkdownSourceEditor documentKey="vault/a.md" value={value} onChange={setValue} />;
}
function select(editor: HTMLTextAreaElement, start: number, end: number) {
  editor.focus(); editor.setSelectionRange(start, end); fireEvent.select(editor);
}

test("toolbar acts on the text selection, restores it, and shares undo with keyboard edits", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  select(editor, 2, 4);
  await user.click(screen.getByRole("button", { name: "加粗", exact: true }));
  expect(editor).toHaveValue("研究**结论**");
  expect(editor).toHaveFocus();
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 6]);
  await user.keyboard("{Control>}z{/Control}");
  expect(editor).toHaveValue("研究结论");
  await user.click(screen.getByRole("button", { name: "重做", exact: true }));
  expect(editor).toHaveValue("研究**结论**");
  await user.keyboard("补充");
  expect(editor).toHaveValue("研究**补充**");
  await user.click(screen.getByRole("button", { name: "撤销", exact: true }));
  expect(editor).toHaveValue("研究**结论**");
});

test("menu commands retain the original selection after focus moves to the menu", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  select(editor, 2, 4);
  await user.click(screen.getByRole("button", { name: "更多 Markdown 工具" }));
  await user.click(screen.getByRole("menuitem", { name: "独立公式", exact: true }));
  expect(editor).toHaveValue("研究\n\n$$\n结论\n$$\n");
  expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("结论");
});

test("keyboard formatting works on macOS and does not interfere with IME composition", () => {
  render(<Editor />);
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  select(editor, 0, 2);
  fireEvent.keyDown(editor, { key: "b", metaKey: true });
  expect(editor).toHaveValue("**研究**结论");
  fireEvent.compositionStart(editor);
  fireEvent.change(editor, { target: { value: "**学**结论", selectionStart: 3, selectionEnd: 3 } });
  fireEvent.keyDown(editor, { key: "b", ctrlKey: true, isComposing: true });
  fireEvent.change(editor, { target: { value: "**学术**结论", selectionStart: 4, selectionEnd: 4 } });
  fireEvent.compositionEnd(editor);
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  expect(editor).toHaveValue("**研究**结论");
});

test("switching files or loading an external revision clears undo without changing the new file", () => {
  const changed = vi.fn();
  function ReloadableEditor() {
    const [file, setFile] = useState({ key: "a", value: "abc" });
    return <><MarkdownSourceEditor documentKey={file.key} value={file.value} onChange={(value) => { changed(value); setFile({ ...file, value }); }} />
      <button onClick={() => setFile({ key: "a", value: "external revision" })}>载入磁盘修改</button>
      <button onClick={() => setFile({ key: "b", value: "another file" })}>切换文件</button></>;
  }
  render(<ReloadableEditor />);
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  select(editor, 0, 3);
  fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
  expect(screen.getByRole("button", { name: "撤销", exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "载入磁盘修改" }));
  expect(screen.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "切换文件" }));
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  expect(editor).toHaveValue("another file");
  expect(changed).toHaveBeenCalledTimes(1);
});
