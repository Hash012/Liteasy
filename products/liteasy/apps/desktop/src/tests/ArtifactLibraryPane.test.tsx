import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ArtifactLibraryPane } from "../app/features/artifacts/ArtifactLibraryPane";
import type { ArtifactExportRecord } from "../app/features/artifacts/artifactExport.types";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";

const savedArtifacts: ArtifactTab[] = [{
  artifactId: "artifact-thin-reading",
  createdAt: "2026-08-09T01:00:00.000Z",
  papers: [{ id: "paper-attention", title: "Attention Is All You Need" }],
  title: "薄读",
  type: "thin_reading"
}, {
  artifactId: "artifact-other-map",
  createdAt: "2026-08-09T00:00:00.000Z",
  papers: [{ id: "paper-other", title: "Other Paper" }],
  title: "Other Paper Map",
  type: "mindmap"
}];

const desktopExport: ArtifactExportRecord = {
  artifactId: "artifact-thin-reading",
  exportedAt: "2026-08-09T03:00:00.000Z",
  fileName: "薄读.md",
  format: "markdown",
  id: "export-desktop",
  location: "desktop",
  path: "/home/user/Documents/薄读.md",
  status: "available",
  title: "薄读"
};

function props() {
  return {
    accountAvailable: true,
    artifactCatalog: savedArtifacts,
    artifactCatalogLoadState: { status: "ready" as const },
    exportError: undefined,
    exportRecords: [] as ArtifactExportRecord[],
    exportStatus: "ready" as const,
    onDeleteArtifact: vi.fn(async () => undefined),
    onOpenArtifact: vi.fn(),
    onOpenExport: vi.fn(async () => undefined),
    onReloadArtifactCatalog: vi.fn(async () => undefined),
    onRefreshExports: vi.fn(async () => undefined),
    onRemoveExport: vi.fn(async () => undefined),
    onRenameArtifact: vi.fn(async () => undefined),
    onRevealExport: vi.fn(async () => undefined)
  };
}

describe("ArtifactLibraryPane", () => {
  test("prompts unauthenticated users to sign in without exposing saved rows", () => {
    render(<ArtifactLibraryPane {...props()} accountAvailable={false} />);

    expect(screen.getByText("登录后查看账号中保存的产物")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开产物/ })).not.toBeInTheDocument();
  });

  test("shows accessible loading, error, and empty saved states", async () => {
    const { rerender } = render(
      <ArtifactLibraryPane
        {...props()}
        artifactCatalog={[]}
        artifactCatalogLoadState={{ status: "loading" }}
      />
    );
    expect(screen.getByRole("progressbar", { name: "正在加载已保存产物" })).toBeInTheDocument();

    const retry = vi.fn(async () => undefined);
    rerender(
      <ArtifactLibraryPane
        {...props()}
        artifactCatalog={[]}
        artifactCatalogLoadState={{ message: "network unavailable", status: "error" }}
        onReloadArtifactCatalog={retry}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("network unavailable");
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(
      <ArtifactLibraryPane
        {...props()}
        artifactCatalog={[]}
        artifactCatalogLoadState={{ status: "ready" }}
      />
    );
    expect(screen.getByText("暂无已保存产物")).toBeInTheDocument();
  });

  test("filters saved artifacts by title, type label, and source paper", async () => {
    const user = userEvent.setup();
    render(<ArtifactLibraryPane {...props()} />);
    const search = screen.getByRole("searchbox", { name: "搜索产物" });

    await user.type(search, "Attention");
    expect(screen.getByRole("button", { name: "打开产物：薄读" })).toBeInTheDocument();
    expect(screen.queryByText("Other Paper Map")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "思维导图");
    expect(screen.getByRole("button", { name: "打开产物：Other Paper Map" })).toBeInTheDocument();
    expect(screen.queryByText("薄读")).not.toBeInTheDocument();
  });

  test("opens saved artifacts and uses dialogs for rename and delete", async () => {
    const user = userEvent.setup();
    const paneProps = props();
    render(<ArtifactLibraryPane {...paneProps} />);

    await user.click(screen.getByRole("button", { name: "打开产物：薄读" }));
    expect(paneProps.onOpenArtifact).toHaveBeenCalledWith("artifact-thin-reading");

    await user.click(screen.getByRole("button", { name: "产物操作：薄读" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const nameInput = screen.getByRole("textbox", { name: "产物名称" });
    await user.clear(nameInput);
    await user.type(nameInput, "新的薄读");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(paneProps.onRenameArtifact).toHaveBeenCalledWith(
      "artifact-thin-reading",
      "新的薄读"
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "重命名产物" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "产物操作：薄读" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(await screen.findByRole("dialog", { name: "删除产物" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(paneProps.onDeleteArtifact).toHaveBeenCalledWith("artifact-thin-reading");
  });

  test("offers open, reveal, and remove actions for available desktop exports", async () => {
    const user = userEvent.setup();
    const paneProps = props();
    render(<ArtifactLibraryPane {...paneProps} exportRecords={[desktopExport]} />);
    await user.click(screen.getByRole("tab", { name: "已导出" }));

    await user.click(screen.getByRole("button", { name: "打开文件：薄读.md" }));
    await user.click(screen.getByRole("button", { name: "在文件夹中显示：薄读.md" }));
    await user.click(screen.getByRole("button", { name: "移除导出记录：薄读.md" }));

    expect(paneProps.onOpenExport).toHaveBeenCalledWith("export-desktop");
    expect(paneProps.onRevealExport).toHaveBeenCalledWith("export-desktop");
    expect(paneProps.onRemoveExport).toHaveBeenCalledWith("export-desktop");
    expect(screen.getByText(desktopExport.path)).toBeInTheDocument();
  });

  test("marks missing files and omits path actions for browser-managed exports", async () => {
    const user = userEvent.setup();
    const missing: ArtifactExportRecord = { ...desktopExport, id: "missing", status: "missing" };
    const browser: ArtifactExportRecord = {
      artifactId: "artifact-browser",
      exportedAt: "2026-08-09T04:00:00.000Z",
      fileName: "网页产物.html",
      format: "html",
      id: "browser",
      location: "browser",
      status: "browser_managed",
      title: "网页产物"
    };
    render(<ArtifactLibraryPane {...props()} exportRecords={[missing, browser]} />);
    await user.click(screen.getByRole("tab", { name: "已导出" }));

    expect(screen.getByText("文件不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件：薄读.md" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "在文件夹中显示：薄读.md" })).toBeDisabled();
    expect(screen.getByText("由浏览器管理")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开文件：网页产物.html" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在文件夹中显示：网页产物.html" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除导出记录：网页产物.html" }))
      .toBeInTheDocument();
  });
});
