import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { BibliographicMetadataEditor } from "../app/features/library/BibliographicMetadataEditor";
import { LibraryMetadataEditor } from "../app/features/library/LibraryMetadataEditor";
import { useBibliographicMetadataController } from "../app/controllers/useBibliographicMetadataController";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";
import { selectPickerValue } from "./helpers/selectPickerValue";

const entry: ReadingCatalogEntry = { id: "book", title: "A book", format: "epub", authors: ["First", "Second", "Third"], isbn: "9780141439518", publisher: "Publisher", volume: "12" };
function Editor({ value = entry, save = vi.fn(async () => {}) }: { value?: ReadingCatalogEntry; save?: (id: string, draft: unknown, revision: number) => Promise<void> }) {
  const model = useBibliographicMetadataController({ scope: "types", entries: [value], selected: value, save });
  return <BibliographicMetadataEditor model={model} />;
}

test("type profiles expose appropriate fields and preserve previous values through type changes", async () => {
  const save = vi.fn(async () => {});
  render(<Editor save={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑元信息" }));
  expect(screen.getByRole("textbox", { name: "出版社", exact: true })).toHaveValue("Publisher");
  expect(screen.getByRole("textbox", { name: "ISBN", exact: true })).toHaveValue("9780141439518");
  await selectPickerValue(screen.getByRole("combobox", { name: "条目类型" }), "webpage");
  fireEvent.change(screen.getByRole("textbox", { name: "网站名称" }), { target: { value: "Research website" } });
  fireEvent.change(screen.getByRole("textbox", { name: "网址" }), { target: { value: "https://example.test" } });
  expect(screen.getByRole("textbox", { name: "访问日期" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "ISBN", exact: true })).toHaveValue("9780141439518");
  expect(screen.getByRole("textbox", { name: "卷", exact: true })).toHaveValue("12");
  fireEvent.click(screen.getByRole("button", { name: "保存元信息" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("book", expect.objectContaining({ assetType: "webpage", publication: "Research website", publisher: "Publisher", isbn: "9780141439518", volume: "12" }), 0));
});

test("classification editor retains an unknown imported type while changing tags", async () => {
  const save = vi.fn(async () => {});
  render(<LibraryMetadataEditor entry={{ ...entry, assetType: "dataset" }} onSave={save} onClose={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "资产类别" })).toHaveTextContent("dataset");
  fireEvent.change(screen.getByRole("textbox", { name: "资产标签" }), { target: { value: "研究数据" } });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetType: "dataset", tags: ["研究数据"] })));
});
