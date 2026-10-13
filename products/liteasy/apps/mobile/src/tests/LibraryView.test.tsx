import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LibraryView } from "../app/features/library/LibraryView";
import type { LibraryItem } from "../app/features/library/library.types";

test("the native mobile category picker keeps its selected facet across search and trash navigation", () => {
  const item: LibraryItem = { id: "paper", kind: "pdf", contentHash: "a".repeat(64), title: "保留文献", filename: "paper.pdf", mimeType: "application/pdf", size: 1,
    collection: "用于论文阅读与跨团队研究的长分类名称", tags: [], note: "", createdAt: "now", updatedAt: "now", page: 1, pinned: false, downloaded: true, revision: 1 };
  render(<LibraryView items={[item, { ...item, id: "other", title: "另一文献", collection: "其他分类" }]} inbox={false} busy={false}
    onImport={vi.fn()} onAdd={vi.fn()} onOpen={vi.fn()} onUpdate={vi.fn()} />);
  const picker = screen.getByRole("combobox", { name: "分类" });
  fireEvent.change(picker, { target: { value: item.collection } });
  expect(picker).toHaveValue(item.collection);
  expect(screen.getByText("保留文献")).toBeVisible();
  expect(screen.queryByText("另一文献")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "回收站" }));
  fireEvent.click(screen.getByRole("button", { name: "返回资料库" }));
  expect(picker).toHaveValue(item.collection);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索资料" }), { target: { value: "无匹配" } });
  expect(screen.queryByText("保留文献")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索资料" }), { target: { value: "" } });
  expect(screen.getByText("保留文献")).toBeVisible();
});
