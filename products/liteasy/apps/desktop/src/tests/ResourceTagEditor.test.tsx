import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createResourceTagDraft, ResourceTagEditor, resourceTagDraftValues } from "../app/features/resource-tags/ResourceTagEditor";

function Editor({ save = vi.fn(), tags = ["RAG"], suggestions = ["rag", "ＲＡＧ", "机器学习", "cafe\u0301", "café"] }: { save?: (tags: string[]) => void; tags?: string[]; suggestions?: string[] }) {
  const [value, setValue] = useState(() => createResourceTagDraft(tags));
  return <form onSubmit={(event) => { event.preventDefault(); save(resourceTagDraftValues(value)); }}>
    <ResourceTagEditor label="标签输入" value={value} onChange={setValue} suggestions={suggestions} />
    <button type="submit">保存</button>
  </form>;
}

test("adds suggestions and Enter tags, removes one tag and sends the actual final values", () => {
  const save = vi.fn();
  render(<Editor save={save} />);
  expect(screen.queryByRole("button", { name: "添加标签 rag", exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "添加标签 café", exact: true })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "添加标签 机器学习", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "移除标签 RAG", exact: true }));
  const input = screen.getByRole("textbox", { name: "标签输入" });
  fireEvent.change(input, { target: { value: "注意力；复现" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(save).not.toHaveBeenCalled();
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "尚未按回车" } });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  expect(save).toHaveBeenCalledWith(["机器学习", "注意力", "复现", "尚未按回车"]);
});

test("pasting multiple lines adds normalized tags and composing Enter does not commit", () => {
  const save = vi.fn();
  render(<Editor save={save} tags={[]} />);
  const input = screen.getByRole("textbox", { name: "标签输入" });
  fireEvent.paste(input, { clipboardData: { getData: () => "cafe\u0301\ncafé\r\n机器学习，复现" } });
  expect(input).toHaveValue("");
  expect(screen.getByRole("button", { name: "移除标签 café", exact: true })).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "中文候选" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(input).toHaveValue("中文候选");
  expect(save).not.toHaveBeenCalled();
});

test("failed tag addition retains text and existing labels with separators stay intact", () => {
  const save = vi.fn();
  render(<Editor save={save} tags={["Washington, D.C."]} />);
  const input = screen.getByRole("textbox", { name: "标签输入" });
  fireEvent.change(input, { target: { value: "a".repeat(61) } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("alert")).toHaveTextContent("每个标签最多 60 个字符");
  expect(input).toHaveValue("a".repeat(61));
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  expect(save).toHaveBeenCalledWith(["Washington, D.C."]);
});
