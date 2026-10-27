import { fireEvent, render, screen, within, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

/** Annotation workflows explicitly open the sidebar; a new reader starts in reading mode. */
export function renderWithPdfAnnotations(ui: ReactElement, options?: RenderOptions) {
  const result = render(ui, options);
  openPdfAnnotations();
  return result;
}

export function openPdfAnnotations() {
  const expand = screen.queryByRole("button", { name: "展开 PDF 左侧栏", exact: true });
  if (expand) fireEvent.click(expand);
}

/** Resolve commands through the same right-click menu used by the reader. */
export function pdfAnnotationAction(excerpt: string, name: string | RegExp, kind?: string) {
  const summaries = screen.getAllByRole("button", { name: `展开批注：${excerpt}` });
  const summary = kind ? summaries.find(button => within(button).queryByRole("img", { name: kind }))! : summaries[0];
  fireEvent.contextMenu(summary.closest("li")!);
  return within(screen.getByRole("menu", { name: `批注信息：${excerpt}` })).getByRole("menuitem", { name, exact: true });
}

export function editExpandedPdfAnnotationNote() {
  fireEvent.click(screen.getByRole("button", { name: /^(编辑批注正文|添加批注笔记)$/ }));
}
