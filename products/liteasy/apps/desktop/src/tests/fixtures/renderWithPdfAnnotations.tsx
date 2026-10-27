import { fireEvent, render, screen, type RenderOptions } from "@testing-library/react";
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
