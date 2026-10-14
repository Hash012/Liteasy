import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesPanel } from "../app/features/notes/NotesPanel";
import type { NotesItem, NotesViewModel } from "../app/features/notes/notes.types";
import { groupNotes, sortNotes } from "../app/features/notes/notesPresentation";
const note = (key: string, title = key, paperId = "paper-a"): NotesItem => ({ key, title, text: "**关键术语**与解释", source: "同名论文", paperIdentity: { id: paperId, title: "同名论文" }, target: { kind: "pdf-annotation", paperId, annotationId: key }, defaultFolderId: "default/paper", updatedAt: "2026-10-14", editable: false });
function model(items = [note("one"), note("two")]): NotesViewModel {
  return { items, folders: [], folderId: "root", query: "", error: "", busy: false,
    selectFolder: vi.fn(), selectItem: vi.fn(), search: vi.fn(), refresh: vi.fn(), connectFolder: vi.fn(), importFiles: vi.fn(), createFolder: vi.fn(), removeFolder: vi.fn(), createNote: vi.fn().mockResolvedValue(undefined), editNote: vi.fn().mockResolvedValue(undefined), collect: vi.fn(), removeReference: vi.fn(), openSource: vi.fn(), drag: vi.fn(), drop: vi.fn() };
}
test("groups by paper identity without merging same-name papers and sorts with a stable key", () => {
  expect(groupNotes([note("a"), note("b", "b", "paper-b")])).toHaveLength(2);
  const items = [note("b", "same"), note("a", "same")];
  expect(sortNotes(items, "title").map(item => item.key)).toEqual(["a", "b"]);
  expect(sortNotes([{ ...items[0], updatedAt: "2026-01-01" }, items[1]], "updated")[0].key).toBe("a");
  expect(sortNotes([{ ...items[0], page: 9 }, { ...items[1], page: 2 }], "page")[0].key).toBe("a");
});
test("selected detail stays inside its row and excerpts render emphasis while titles stay literal", () => {
  const input = model([note("one", "**literal title**"), note("two")]); input.selected = input.items[0];
  render(<NotesPanel model={input} />);
  const row = screen.getByRole("button", { name: "查看笔记 **literal title**" }).closest("article")!;
  expect(within(row).getByRole("region", { name: "打开的笔记" })).toBeInTheDocument();
  expect(screen.getByText("**literal title**")).toBeInTheDocument();
  const other = screen.getByRole("button", { name: "查看笔记 two" }).closest("article")!;
  expect(within(other).getByText("关键术语").tagName).toBe("STRONG");
});
test("keeps unsaved drafts across folder navigation without saving into another folder", async () => {
  const user = userEvent.setup(); const input = model();
  const view = render(<NotesPanel model={input} />);
  await user.click(screen.getByRole("button", { name: "新建笔记" }));
  await user.type(screen.getByRole("textbox", { name: "笔记正文" }), "未保存草稿");
  view.rerender(<NotesPanel model={{ ...input, folderId: "other" }} />);
  expect(screen.queryByRole("textbox", { name: "笔记正文" })).not.toBeInTheDocument();
  view.rerender(<NotesPanel model={input} />);
  expect(screen.getByRole("textbox", { name: "笔记正文" })).toHaveValue("未保存草稿");
  expect(input.createNote).not.toHaveBeenCalled();
});
