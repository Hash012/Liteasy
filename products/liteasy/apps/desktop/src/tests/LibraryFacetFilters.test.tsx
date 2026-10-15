import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LibraryFacetFilters } from "../app/features/library/LibraryFacetFilters";
import { indexReadingCatalog, queryReadingCatalog, type ReadingCatalogFilters } from "../app/features/library/readingCatalogSearch";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";

const defaults: ReadingCatalogFilters = { query: "", format: "all", status: "all", collection: "", year: "", sort: "title" };
function Filters({ entries, initial = defaults, changed = vi.fn() }: { entries: ReadingCatalogEntry[]; initial?: ReadingCatalogFilters; changed?: (filters: ReadingCatalogFilters) => void }) {
  const [filters, setFilters] = useState(initial);
  return <><LibraryFacetFilters entries={entries} filters={filters} onChange={(next) => { changed(next); setFilters(next); }} />
    <p role="status">匹配 {queryReadingCatalog(indexReadingCatalog(entries), filters).length} 项</p></>;
}

test("facet counts, pressed state and include/exclude results share normalized tag identity", () => {
  const entries: ReadingCatalogEntry[] = [
    { id: "a", title: "A", format: "pdf", tags: ["RAG", "rag", "ＲＡＧ"] },
    { id: "b", title: "B", format: "epub", tags: ["rag"] },
    { id: "c", title: "C", format: "html", tags: ["Other"] },
  ];
  render(<Filters entries={entries} initial={{ ...defaults, tags: ["ＲＡＧ"] }} />);
  expect(screen.getByRole("button", { name: "包含标签 RAG（2 项）" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("匹配 2 项");
  fireEvent.click(screen.getByRole("button", { name: "排除标签 RAG", exact: true }));
  expect(screen.getByRole("button", { name: "包含标签 RAG（2 项）" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("status")).toHaveTextContent("匹配 1 项");
  fireEvent.click(screen.getByRole("button", { name: "包含标签 RAG（2 项）" }));
  expect(screen.getByRole("button", { name: "排除标签 RAG", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("status")).toHaveTextContent("匹配 2 项");
  fireEvent.change(screen.getByRole("textbox", { name: "查找标签" }), { target: { value: "ｒａｇ" } });
  expect(screen.getByRole("button", { name: "包含标签 RAG（2 项）" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "包含标签 Other（1 项）" })).not.toBeInTheDocument();
});

test("active tags remain removable beyond the visible limit or when no longer present in the library", () => {
  const changed = vi.fn();
  const entries: ReadingCatalogEntry[] = [{ id: "many", title: "Many", format: "pdf", tags: [...Array.from({ length: 70 }, (_, index) => `tag-${index.toString().padStart(2, "0")}`), "zzzz"] }];
  render(<Filters entries={entries} initial={{ ...defaults, tags: ["zzzz"], excludeTags: ["已删除的标签"] }} changed={changed} />);
  expect(screen.queryByRole("button", { name: "包含标签 zzzz（1 项）" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消包含标签 zzzz" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "查找标签" }), { target: { value: "没有匹配" } });
  fireEvent.click(screen.getByRole("button", { name: "取消包含标签 zzzz" }));
  fireEvent.click(screen.getByRole("button", { name: "取消排除标签 已删除的标签" }));
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ tags: [], excludeTags: [] }));
  expect(screen.queryByRole("group", { name: "已启用的标签筛选" })).not.toBeInTheDocument();
});
