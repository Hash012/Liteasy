import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { LibraryPane } from "../app/features/library/LibraryPane";
import { savePaperFileMetadata } from "../app/features/library/paperFileMetadata";

const paper = {
  id: "paper-file-management",
  sourcePath: "/library/paper.pdf",
  title: "Vector Retrieval Survey"
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function renderLibraryPane(childProps: Partial<React.ComponentProps<typeof LibraryPane>> = {}) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <LibraryPane
        accountSessionAvailable={false}
        canOpenOrganizationWorkspace={false}
        cloudEndpoint=""
        importJobs={{}}
        localLibrarySnapshot={{
          entries: [{
            contentHash: "hash",
            id: paper.id,
            path: paper.sourcePath,
            relativePath: "paper.pdf",
            title: paper.title
          }],
          folders: [],
          libraryId: "library-1",
          revision: 1,
          rootPath: "/library",
          trashEntries: []
        }}
        onClearRecommendations={vi.fn()}
        onDismissRecommendation={vi.fn()}
        onOpenOrganizationWorkspace={vi.fn()}
        onReturnToLocalWorkspace={vi.fn()}
        onToggleLock={vi.fn()}
        onToggleSelection={vi.fn()}
        papers={[paper]}
        recommendationItems={[]}
        recommendationMessage=""
        recommendationPending={false}
        recommendationStatus="ready"
        selectedPaperIds={[]}
        selectionLocked={false}
        workspaceLabel="本地文献库"
        workspaceSourceType="local_library"
        {...childProps}
      />
    </FluentProvider>
  );
}

test("edits, displays and filters local papers by category and tags", async () => {
  const user = userEvent.setup();
  await savePaperFileMetadata(paper.id, {
    category: "机器学习",
    tags: ["RAG", "向量检索"]
  });
  renderLibraryPane();

  const metadata = await screen.findByLabelText(`${paper.title} 的分类与标签`);
  expect(within(metadata).getByText("机器学习")).toBeInTheDocument();
  expect(within(metadata).getByText("向量检索")).toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "按论文分类筛选" }), "机器学习");
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();

  await user.clear(screen.getByRole("textbox", { name: "搜索文献资源" }));
  await user.type(screen.getByRole("textbox", { name: "搜索文献资源" }), "RAG");
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();

  await user.clear(screen.getByRole("textbox", { name: "搜索文献资源" }));
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: paper.title }) });
  // Pointer movement across the context menu is covered by the browser test;
  // dispatch the action directly here to isolate metadata editing from jsdom motion.
  fireEvent.click(await screen.findByRole("menuitem", { name: "编辑分类与标签" }));
  await screen.findByRole("dialog", { name: "编辑论文分类与标签" });
  // Move focus into the editor after the menu restores focus in jsdom.
  await user.click(screen.getByLabelText("论文分类"));
  fireEvent.change(screen.getByRole("textbox", { name: "论文分类" }), {
    target: { value: "已精读" }
  });
  fireEvent.change(screen.getByRole("textbox", { name: "论文标签" }), {
    target: { value: "检索, 必读" }
  });
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑论文分类与标签" })).not.toBeInTheDocument());
  const updatedMetadata = await screen.findByLabelText(`${paper.title} 的分类与标签`);
  expect(within(updatedMetadata).getByText("已精读")).toBeInTheDocument();
  expect(within(updatedMetadata).getByText("必读")).toBeInTheDocument();
});

test("retrieves paper metadata from the context menu and shows the result", async () => {
  let finish!: (message: string) => void;
  const onRetrievePaperMetadata = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  renderLibraryPane({ onRetrievePaperMetadata });
  fireEvent.contextMenu(await screen.findByRole("button", { name: paper.title }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "获取元数据" }));
  expect(onRetrievePaperMetadata).toHaveBeenCalledWith(paper);
  expect(await screen.findByText("正在获取元数据...")).toBeInTheDocument();
  finish("已获取论文元数据。");
  expect(await screen.findByText("已获取论文元数据。")).toBeInTheDocument();
});

test("shows metadata request failures in the library", async () => {
  renderLibraryPane({ onRetrievePaperMetadata: vi.fn().mockRejectedValue(new Error("元数据服务暂时不可用")) });
  fireEvent.contextMenu(await screen.findByRole("button", { name: paper.title }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "获取元数据" }));
  expect(await screen.findByText("元数据服务暂时不可用")).toBeInTheDocument();
});

test("opens a saved multimodal document under its source paper", async () => {
  const open = vi.fn();
  const child = { id: "thin-1", kind: "artifact" as const, label: "薄读：方法" };
  renderLibraryPane({ paperChildren: { [paper.id]: [child] }, onOpenPaperChild: open });
  await userEvent.click(screen.getByText("论文文件（1）"));
  await userEvent.click(screen.getByRole("button", { name: "打开论文文件：薄读：方法" }));
  expect(open).toHaveBeenCalledWith(child, paper);
});

test("left-click opens a paper and right-click exposes identity confirmation", async () => {
  const open = vi.fn(); const resolve = vi.fn();
  renderLibraryPane({ onOpenPaper: open, onResolvePaperIdentity: resolve });
  await userEvent.click(screen.getByRole("button", { name: paper.title }));
  expect(open).toHaveBeenCalled();
  expect(screen.queryByRole("menuitem", { name: "确认文献身份" })).not.toBeInTheDocument();
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: paper.title }) });
  await userEvent.click(await screen.findByRole("menuitem", { name: "确认文献身份" }));
  expect(resolve).toHaveBeenCalledWith(paper);
});

test("unifies paper selection, metadata search and file format filters without opening on selection", async () => {
  const user = userEvent.setup(), inspect = vi.fn(), openPaper = vi.fn();
  const pdf = { id: paper.id, title: paper.title, format: "pdf" as const, authors: ["Lin Researcher"], year: 2024, doi: "10.1234/vector" };
  renderLibraryPane({ onOpenPaper: openPaper, fileLibrary: {
    entries: [pdf, { id: "ebook", title: "Field Guide", format: "epub", readingStatus: "unread" }],
    pending: false, message: "", onImport: vi.fn(), onInspect: inspect, onOpen: vi.fn()
  } });
  await user.click(screen.getByRole("button", { name: paper.title, exact: true }));
  expect(inspect).toHaveBeenCalledWith(pdf, expect.any(Function));
  expect(openPaper).not.toHaveBeenCalled();
  await user.dblClick(screen.getByRole("button", { name: paper.title, exact: true }));
  expect(openPaper).toHaveBeenCalledWith(paper.id);
  await user.type(screen.getByRole("textbox", { name: "搜索文献资源" }), '"Lin Researcher" 10.1234/vector');
  expect(screen.getByRole("button", { name: paper.title, exact: true })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "选择文件 Field Guide" })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索文献资源" }));
  await user.click(screen.getByRole("button", { name: "筛选本地文件" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "筛选文件格式" }), "epub");
  expect(screen.queryByRole("button", { name: paper.title, exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择文件 Field Guide" })).toBeInTheDocument();
});

const foldersSnapshot = {
  entries: [], libraryId: "folders", revision: 1, rootPath: "/library", trashEntries: [],
  folders: [{ name: "eBooks", path: "/library/eBooks", parentPath: null },
    { name: "Topics", path: "/library/eBooks/Topics", parentPath: "/library/eBooks" }]
};
function transferData(files: File[] = [], payload: Record<string, string> = {}) {
  return { files, items: [], types: [...Object.keys(payload), ...(files.length ? ["Files"] : [])],
    getData: (key: string) => payload[key] ?? "", setData: vi.fn(), dropEffect: "none" };
}
function fileAccess(overrides: Partial<NonNullable<React.ComponentProps<typeof LibraryPane>["fileLibrary"]>> = {}) {
  return { entries: [], pending: false, message: "", onImport: vi.fn(async () => "已导入 1 个文件。"),
    onInspect: vi.fn(), onOpen: vi.fn(), onMoveFile: vi.fn(async () => {}), ...overrides };
}

test("highlights the hovered directory, imports there once, and reports completion", async () => {
  const access = fileAccess();
  renderLibraryPane({ localLibrarySnapshot: foldersSnapshot, fileLibrary: access });
  const folder = screen.getByRole("button", { name: "eBooks", exact: true }).closest(".library-folder-row")!;
  const file = new File(["# Reading"], "notes.md", { type: "text/markdown" });
  const dataTransfer = transferData([file]);
  fireEvent.dragEnter(folder, { dataTransfer });
  expect(folder).toHaveClass("is-drop-target");
  expect(screen.getByRole("status")).toHaveTextContent("松开即可导入“eBooks”");
  fireEvent.dragLeave(folder, { dataTransfer, relatedTarget: document.body });
  expect(folder).not.toHaveClass("is-drop-target");
  fireEvent.dragOver(folder, { dataTransfer });
  fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(access.onImport).toHaveBeenCalledExactlyOnceWith([file], "/library/eBooks"));
  expect(await screen.findByText("目标：eBooks。已导入 1 个文件。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "收起eBooks" })).toHaveAttribute("aria-expanded", "true");
  expect(folder).not.toHaveClass("is-drop-target");
});

test("moves existing reading files and exposes write failures without a success message", async () => {
  const move = vi.fn().mockRejectedValue(new Error("存储空间不足"));
  renderLibraryPane({ localLibrarySnapshot: foldersSnapshot, fileLibrary: fileAccess({ onMoveFile: move }) });
  const folder = screen.getByRole("button", { name: "eBooks", exact: true });
  const dataTransfer = transferData([], { "application/x-liteasy-reading-file": "ebook-1" });
  fireEvent.dragOver(folder, { dataTransfer });
  expect(screen.getByRole("status")).toHaveTextContent("松开即可移入“eBooks”");
  fireEvent.drop(folder, { dataTransfer });
  expect(await screen.findByText("存储空间不足")).toBeInTheDocument();
  expect(move).toHaveBeenCalledExactlyOnceWith("ebook-1", "/library/eBooks");
  expect(screen.queryByText("文件已移入“eBooks”。")).not.toBeInTheDocument();
});

test("rejects moving a folder into its descendant and keeps the drop feedback explicit", async () => {
  const move = vi.fn();
  renderLibraryPane({ localLibrarySnapshot: foldersSnapshot, onMoveFolder: move });
  fireEvent.click(screen.getByRole("button", { name: "展开eBooks" }));
  const folder = screen.getByRole("button", { name: "Topics", exact: true });
  const dataTransfer = transferData([], { "application/x-liteasy-library-resource-v2": JSON.stringify({
    area: "local", folder: foldersSnapshot.folders[0], tree: { children: [], entries: [], name: "eBooks" }
  }) });
  fireEvent.dragOver(folder, { dataTransfer });
  expect(folder.closest(".library-folder-row")).toHaveClass("is-drop-blocked");
  expect(screen.getByRole("status")).toHaveTextContent("不能将目录移入自身或其子目录");
  fireEvent.drop(folder, { dataTransfer });
  expect(move).not.toHaveBeenCalled();
});

test("shows non-PDF files inside their folder, finds them through search, and keeps orphaned files visible", async () => {
  renderLibraryPane({ localLibrarySnapshot: foldersSnapshot, fileLibrary: fileAccess({ entries: [
    { id: "book", title: "Research Handbook", format: "epub", folderPath: "eBooks/Topics" },
    { id: "orphan", title: "Old notes", format: "markdown", folderPath: "Deleted" }
  ] }) });
  expect(screen.queryByRole("button", { name: "选择文件 Research Handbook" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择文件 Old notes" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索文献资源" }), { target: { value: "Handbook" } });
  const book = await screen.findByRole("button", { name: "选择文件 Research Handbook" });
  expect(book.closest(".library-folder-node")).toHaveTextContent("Topics");
  expect(screen.getAllByRole("button", { name: "选择文件 Research Handbook" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "选择文件 Old notes" })).not.toBeInTheDocument();
});
