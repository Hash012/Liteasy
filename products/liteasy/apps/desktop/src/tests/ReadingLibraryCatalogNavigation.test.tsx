import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ReadingLibraryCatalog } from "../app/features/library/ReadingLibraryCatalog";

const entries = Array.from({ length: 123 }, (_, index) => ({ id: String(index), title: `文献 ${String(index + 1).padStart(3, "0")}`, format: "pdf" as const, addedAt: new Date(2026, 0, 124 - index).toISOString() }));
const rows = () => within(screen.getByRole("table", { name: "文献与文件列表" })).getAllByRole("row").slice(1);

test("keyboard navigation crosses page boundaries while keeping only 50 rows mounted", () => {
  const onOpen = vi.fn();
  render(<ReadingLibraryCatalog entries={entries} onOpen={onOpen} />);
  fireEvent.keyDown(rows()[49], { key: "ArrowDown" });
  expect(rows()).toHaveLength(50);
  expect(rows()[0]).toHaveFocus();
  expect(rows()[0]).toHaveTextContent("文献 051");
  expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(rows()[0], { key: "ArrowUp" });
  expect(rows()[49]).toHaveFocus();
  expect(rows()[49]).toHaveTextContent("文献 050");
  fireEvent.keyDown(rows()[49], { key: "End" });
  expect(rows()).toHaveLength(23);
  expect(rows()[22]).toHaveFocus();
  expect(rows()[22]).toHaveTextContent("文献 123");
  fireEvent.keyDown(rows()[22], { key: "Enter" });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(entries[122]);
  fireEvent.keyDown(rows()[22], { key: "Home" });
  expect(rows()[0]).toHaveFocus();
  fireEvent.keyDown(rows()[0], { key: "PageDown" });
  expect(rows()[0]).toHaveFocus();
  expect(rows()[0]).toHaveTextContent("文献 051");
  fireEvent.keyDown(rows()[0], { key: "PageUp" });
  expect(rows()[0]).toHaveTextContent("文献 001");
  expect(rows()[0]).toHaveFocus();
});

test("navigation stays within filtered results and clamps when entries disappear", () => {
  const view = render(<ReadingLibraryCatalog entries={entries} onOpen={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索文献与文件" }), { target: { value: '"文献 12"' } });
  expect(rows()).toHaveLength(4);
  fireEvent.keyDown(rows()[0], { key: "End" });
  expect(rows()[3]).toHaveTextContent("文献 123");
  expect(rows()[3]).toHaveFocus();
  view.rerender(<ReadingLibraryCatalog entries={entries.slice(0, 121)} onOpen={vi.fn()} />);
  expect(rows()).toHaveLength(2);
  expect(rows()[0]).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
  expect(rows()[1]).toHaveFocus();
  expect(rows()[1]).toHaveTextContent("文献 121");
});
