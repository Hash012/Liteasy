import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileStatusBar } from "../app/layout/FileStatusBar";
import { noteFileStatus, paperFileStatus, useWorkspaceShellController } from "../app/controllers/useWorkspaceShellController";
import type { WorkspaceSurface } from "../app/features/workspace/workspaceShell.types";

const page = (id: string, active = true, region = "left"): WorkspaceSurface => ({ id, title: id, active, region, onActivate: vi.fn() });

describe("workspace shell context", () => {
  it("navigates history, truncates a forward branch and skips closed surfaces", () => {
    const library = page("library");
    const settings = page("settings", false);
    const notes = page("notes", false);
    const input = { layoutActions: [], openSettings: vi.fn() };
    const { result, rerender } = renderHook(({ surfaces }) => useWorkspaceShellController({ ...input, surfaces }), {
      initialProps: { surfaces: [library, settings, notes] }
    });
    rerender({ surfaces: [{ ...library, active: false }, { ...settings, active: true }, notes] });
    expect(result.current.toolbar.title).toBe("settings");
    act(() => result.current.toolbar.onGoBack?.());
    expect(library.onActivate).toHaveBeenCalledOnce();
    rerender({ surfaces: [library, settings, notes] });
    expect(result.current.toolbar.canGoForward).toBe(true);
    rerender({ surfaces: [{ ...library, active: false }, settings, { ...notes, active: true }] });
    expect(result.current.toolbar.canGoForward).toBe(false);
    // Closing the only prior destination cannot leave a dead Back command.
    rerender({ surfaces: [settings, { ...notes, active: true }] });
    expect(result.current.toolbar.canGoBack).toBe(false);
  });

  it("follows focused panes without leaking a PDF status into Settings", () => {
    const document = { ...page("pdf-1", true, "main"), dynamic: true, fileStatus: { type: "PDF", pageCount: 18 } };
    const settings = page("settings");
    const { result, rerender } = renderHook(({ surfaces }) => useWorkspaceShellController({ surfaces, layoutActions: [], openSettings: vi.fn() }), {
      initialProps: { surfaces: [settings, document] }
    });
    expect(result.current.fileStatus?.pageCount).toBe(18);
    act(() => result.current.focusRegion("left"));
    expect(result.current.toolbar.title).toBe("settings");
    expect(result.current.fileStatus).toBeUndefined();
    rerender({ surfaces: [settings, { ...document, region: "bar-reader" }] });
    expect(result.current.toolbar.title).toBe("pdf-1");
    expect(result.current.fileStatus?.pageCount).toBe(18);
  });

  it("does not let restored sidebar tabs steal the initial document context", () => {
    const document = { ...page("pdf-1", true, "main"), dynamic: true };
    const { result, rerender } = renderHook(({ surfaces }) => useWorkspaceShellController({ surfaces, layoutActions: [], openSettings: vi.fn() }), {
      initialProps: { surfaces: [page("library"), document] }
    });
    rerender({ surfaces: [page("notes"), document] });
    expect(result.current.toolbar.title).toBe("pdf-1");
  });
});

describe("ambient file status", () => {
  it("renders only known metadata and describes failures with text", () => {
    const { rerender } = render(<FileStatusBar status={{ name: "Paper", path: "/private/Paper.pdf", type: "PDF", pageCount: 18, size: 1782579, source: "local", indexState: "indexing" }} />);
    expect(screen.getByLabelText("文件状态栏")).toHaveTextContent("PDF · 18 页 · 1.7 MB · 本地");
    expect(screen.getByRole("status")).toHaveTextContent("正在索引…");
    expect(screen.getByLabelText("文件状态栏").textContent).not.toContain("/private/");
    rerender(<FileStatusBar status={{ syncState: "error", pageCount: NaN, size: -1, modifiedAt: new Date("invalid") }} />);
    expect(screen.getByRole("status")).toHaveTextContent("同步失败");
    expect(screen.getByLabelText("文件状态栏").textContent).not.toMatch(/NaN|Invalid|-1/);
    rerender(<FileStatusBar />);
    expect(screen.getByLabelText("文件状态栏")).toHaveTextContent("Liteasy · 就绪");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("never infers synchronized or indexed state from an open document", () => {
    const paper = { id: "p", title: "Paper", sourcePath: "/library/p.pdf" };
    expect(paperFileStatus(paper)).toMatchObject({ type: "PDF", source: "local", indexState: undefined });
    expect(paperFileStatus(paper).syncState).toBeUndefined();
    expect(paperFileStatus({ ...paper, sourcePath: "https://example.test/p.pdf" }).source).toBe("remote");
    expect(paperFileStatus(paper, { id: "j", documentId: "p", sourcePath: paper.sourcePath, status: "failed" }).indexState).toBe("error");
    expect(noteFileStatus()).toBeUndefined();
  });
});
