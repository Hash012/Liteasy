import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PaperNoteEditor } from "../app/features/paper-projects/PaperNoteEditor";
import { ExternalNoteEditor } from "../app/features/note-files/ExternalNoteEditor";

afterEach(() => localStorage.removeItem("liteasy.markdown.font-size.v1"));

test("Markdown text size affects edit and reading views, persists, and is shared with external Markdown", () => {
  localStorage.setItem("liteasy.markdown.font-size.v1", "16");
  const note = { object: { objectId: "CicN", title: "CicN" }, draft: "# CicN\n\nEvidence paragraph", saved: "# CicN\n\nEvidence paragraph" };
  const model = { session: note, drafts: [], busy: false, error: "", save: vi.fn(), reload: vi.fn(), select: vi.fn(), setDraft: vi.fn() };
  const view = render(<FluentProvider theme={webLightTheme}><PaperNoteEditor model={model} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "调整 Markdown 字号" }));
  fireEvent.change(screen.getByRole("slider", { name: "Markdown 字号" }), { target: { value: "24" } });
  expect(screen.getByRole("region", { name: "论文 Markdown 笔记" })).toHaveStyle({ "--markdown-font-size": "24px" });
  fireEvent.keyDown(screen.getByRole("slider", { name: "Markdown 字号" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "阅读", exact: true }));
  expect(screen.getByText("Evidence paragraph").closest(".external-note-editor")).toHaveStyle({ "--markdown-font-size": "24px" });
  view.unmount();
  render(<FluentProvider theme={webLightTheme}><ExternalNoteEditor model={{ session: { snapshot: { mountId: "notes", path: "CicN.md", name: "CicN.md",
    kind: "file", text: "# CicN\n\nAnother paragraph", version: "v1" }, draft: "# CicN\n\nAnother paragraph", editing: false, changed: false },
    busy: false, error: "", notice: "", drafts: [], open: vi.fn(), setDraft: vi.fn(), setEditing: vi.fn(), save: vi.fn(), reload: vi.fn() }} /></FluentProvider>);
  expect(screen.getByRole("region", { name: "Markdown 文件阅读与编辑" })).toHaveStyle({ "--markdown-font-size": "24px" });
  fireEvent.click(screen.getByRole("button", { name: "调整 Markdown 字号" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复默认字号" }));
  expect(screen.getByRole("region", { name: "Markdown 文件阅读与编辑" })).toHaveStyle({ "--markdown-font-size": "16px" });
});
