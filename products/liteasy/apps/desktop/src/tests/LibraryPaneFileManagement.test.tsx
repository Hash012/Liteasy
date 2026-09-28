import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mockFocusLayout } from "./fixtures/mockFocusLayout";
import { LibraryPane } from "../app/features/library/LibraryPane";
import { savePaperFileMetadata } from "../app/features/library/paperFileMetadata";

const paper = {
  id: "paper-file-management",
  sourcePath: "/library/paper.pdf",
  title: "Vector Retrieval Survey"
};

let restoreFocusLayout: () => void;
beforeEach(() => { restoreFocusLayout = mockFocusLayout(); });
afterEach(() => {
  restoreFocusLayout();
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

test("opens papers on a single click while retaining metadata inspection and file filters", async () => {
  const user = userEvent.setup(), inspect = vi.fn(), openPaper = vi.fn();
  const pdf = { id: paper.id, title: paper.title, format: "pdf" as const, authors: ["Lin Researcher"], year: 2024, doi: "10.1234/vector" };
  renderLibraryPane({ onOpenPaper: openPaper, fileLibrary: {
    entries: [pdf, { id: "ebook", title: "Field Guide", format: "epub", readingStatus: "unread" }],
    pending: false, message: "", onImport: vi.fn(), onInspect: inspect, onOpen: vi.fn()
  } });
  await user.click(screen.getByRole("button", { name: paper.title, exact: true }));
  expect(inspect).toHaveBeenCalledWith(pdf, expect.any(Function));
  expect(openPaper).toHaveBeenCalledOnce();
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

test("places Windows PDFs under their actual nested folder across slash and prefix variants", async () => {
  const root = String.raw`\\?\D:\Library`;
  const snapshot = {
    ...foldersSnapshot, rootPath: root,
    folders: [{ name: "trial", path: `${root}\\trial`, parentPath: null },
      { name: "Nested", path: `${root}\\trial\\Nested`, parentPath: "d:/library/trial" }],
    entries: [{ id: paper.id, title: paper.title, contentHash: "hash", path: "//?/D:/Library/trial/Nested/paper.pdf", relativePath: "trial/Nested/paper.pdf" }]
  };
  renderLibraryPane({ localLibrarySnapshot: snapshot });
  expect(screen.queryByRole("button", { name: paper.title })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开trial" }));
  fireEvent.click(screen.getByRole("button", { name: "展开Nested" }));
  const file = screen.getByRole("button", { name: paper.title });
  expect(file.closest(".library-folder-node")).toHaveTextContent("Nested");
  expect(screen.getAllByRole("button", { name: paper.title })).toHaveLength(1);
});

test("persists a custom folder icon, keeps it after rename, and restores its default", async () => {
  const renamed = vi.fn(async () => "已将目录重命名为 /library/Books。");
  const view = renderLibraryPane({ localLibrarySnapshot: foldersSnapshot, onRenameFolder: renamed });
  const folder = screen.getByRole("button", { name: "eBooks", exact: true });
  fireEvent.contextMenu(folder);
  fireEvent.click(await screen.findByRole("menuitem", { name: "更换图标" }));
  fireEvent.click(await screen.findByRole("button", { name: "书籍", exact: true }));
  expect(folder.querySelector("[data-icon]")).toHaveAttribute("data-icon", "book");
  vi.spyOn(window, "prompt").mockReturnValue("Books");
  fireEvent.contextMenu(folder);
  fireEvent.click(await screen.findByRole("menuitem", { name: "重命名", exact: true }));
  await waitFor(() => expect(renamed).toHaveBeenCalled());
  view.unmount();
  renderLibraryPane({ localLibrarySnapshot: { ...foldersSnapshot, folders: [{ name: "Books", path: "/library/Books", parentPath: null }] } });
  const bookFolder = screen.getByRole("button", { name: "Books", exact: true });
  expect(bookFolder.querySelector("[data-icon]")).toHaveAttribute("data-icon", "book");
  fireEvent.contextMenu(bookFolder);
  fireEvent.click(await screen.findByRole("menuitem", { name: "更换图标" }));
  fireEvent.click(await screen.findByRole("button", { name: "恢复默认图标" }));
  expect(bookFolder.querySelector("[data-icon]")).toHaveAttribute("data-icon", "folder");
});

test("distinguishes paper derivatives and offers custom icons for ordinary files", async () => {
  renderLibraryPane({ activePaperId: paper.id, paperChildren: { [paper.id]: [
    { id: "text", label: "论文文本", kind: "extracted_text" },
    { id: "figures", label: "论文插图", kind: "figures" },
    { id: "combined", label: "论文图文", kind: "multimodal" }
  ] }, fileLibrary: fileAccess({ entries: [{ id: "book", title: "My Book", format: "mobi" }] }) });
  for (const [label, icon] of [["论文文本", "text"], ["论文插图", "images"], ["论文图文", "multimodal"]]) {
    expect(screen.getByRole("button", { name: `打开论文文件：${label}` }).querySelector("[data-icon]")).toHaveAttribute("data-icon", icon);
  }
  const book = screen.getByRole("button", { name: "选择文件 My Book" });
  expect(book.querySelector("[data-icon]")).toHaveAttribute("data-icon", "book");
  fireEvent.contextMenu(book);
  fireEvent.click(await screen.findByRole("menuitem", { name: "更换图标" }));
  fireEvent.click(await screen.findByRole("button", { name: "星标", exact: true }));
  expect(book.querySelector("[data-icon]")).toHaveAttribute("data-icon", "star");
});


test("creates a named Markdown attachment from a paper context menu", async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  renderLibraryPane({ onCreatePaperChild: create });
  fireEvent.contextMenu(screen.getByRole("button", { name: paper.title, exact: true }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "新建 Markdown 笔记" }));
  const dialog = await screen.findByRole("dialog", { name: "新建 Markdown 笔记" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "论文附件名称" }), { target: { value: "实验复现笔记" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(paper, "note", "实验复现笔记"));
});

test("custom emoji icons including skin tone and joined sequences survive reopening", async () => {
  const view = renderLibraryPane();
  const paperButton = screen.getByRole("button", { name: paper.title, exact: true });
  fireEvent.contextMenu(paperButton);
  fireEvent.click(await screen.findByRole("menuitem", { name: "更换图标" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Emoji" }));
  fireEvent.change(screen.getByRole("textbox", { name: "自定义 Emoji" }), { target: { value: "two letters" } });
  expect(screen.getByRole("button", { name: "使用 Emoji" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "自定义 Emoji" }), { target: { value: "👩🏽‍🔬" } });
  fireEvent.click(screen.getByRole("button", { name: "使用 Emoji" }));
  expect(paperButton.closest(".library-paper-row")!.querySelector('[data-icon="emoji"]')).toHaveTextContent("👩🏽‍🔬");
  view.unmount(); renderLibraryPane();
  expect(screen.getByRole("button", { name: paper.title, exact: true }).closest(".library-paper-row")!.querySelector('[data-icon="emoji"]')).toHaveTextContent("👩🏽‍🔬");
});

test("expanded library retains search and file actions inside a closable dialog", async () => {
  const close = vi.fn(), open = vi.fn();
  renderLibraryPane({ expanded: true, onCloseExpanded: close, onOpenPaper: open });
  const dialog = await screen.findByRole("dialog", { name: "文献库", exact: true });
  fireEvent.click(within(dialog).getByRole("button", { name: paper.title, exact: true }));
  expect(open).toHaveBeenCalledWith(paper.id);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭文献库浮窗" }));
  expect(close).toHaveBeenCalledOnce();
});


test("shows confirmed paper titles immediately even when the physical filename stays unchanged", async () => {
  const title = "The Official Research Title";
  renderLibraryPane({ papers: [{ ...paper, title, authors: ["Alice Smith"] }] });
  expect(screen.getByRole("button", { name: title, exact: true })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: paper.title, exact: true })).not.toBeInTheDocument();
  await userEvent.type(screen.getByRole("textbox", { name: "搜索文献资源" }), "Official");
  expect(screen.getByRole("button", { name: title, exact: true })).toBeInTheDocument();
});
