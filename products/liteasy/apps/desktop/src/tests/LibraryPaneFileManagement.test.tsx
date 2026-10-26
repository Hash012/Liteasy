import { selectPickerValue } from "./helpers/selectPickerValue";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mockFocusLayout } from "./fixtures/mockFocusLayout";
import { LibraryPane, personalLibraryScopeId } from "../app/features/library/LibraryPane";
import { savePaperFileMetadata } from "../app/features/library/paperFileMetadata";
import * as fileSystem from "../app/features/library/libraryFileSystemClient";
import * as cloudTree from "../app/features/library/useCloudLibraryTree";
import * as cloudStorage from "../app/features/library/cloudLibraryStorageClient";

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

function mockPersonalCollection() {
  const entry = {
    documentId: "cloud_pdf", entryKind: "pdf" as const, fileName: "Cloud paper.pdf", title: "Cloud paper",
    byteLength: 10, contentHash: "a".repeat(64), status: "active" as const,
    createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z",
    scopeId: "user_1", scopeType: "user" as const, uploadedBy: "user_1"
  };
  vi.spyOn(cloudTree, "useCloudLibraryTree").mockImplementation((input) => ({
    message: "", quota: null, refresh: vi.fn().mockResolvedValue(undefined), status: "ready", trashTree: null,
    tree: input.scopeType === "user" ? { scopeId: "user_1", scopeType: "user", entries: [entry], folders: [], revision: 1 } : null
  }));
  return entry;
}

test("copies a personal cloud PDF to the selected local library through the existing transfer action", async () => {
  const entry = mockPersonalCollection();
  const onResourceTransfer = vi.fn().mockResolvedValue(undefined);
  renderLibraryPane({ accountSessionAvailable: true, accountScopeId: "user_1", onResourceTransfer });
  fireEvent.contextMenu(await screen.findByRole("button", { name: "Cloud paper", exact: true }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制到本机文献库", exact: true }));
  expect(onResourceTransfer).not.toHaveBeenCalled();
  const preview = await screen.findByRole("dialog", { name: "确认资料转移" });
  expect(within(preview).getByText("目标：本机文献库 · /library")).toBeInTheDocument();
  expect(within(preview).getByText("1 个 PDF，0 条仅元数据条目。")).toBeInTheDocument();
  fireEvent.click(within(preview).getByRole("button", { name: "确认复制" }));
  await waitFor(() => expect(onResourceTransfer).toHaveBeenCalledWith({ area: "collection", entry, scope: { scopeId: "user_1", scopeType: "user" } }, { area: "local", localFolderPath: "/library" }));
  expect(await screen.findByText("已复制到本机文献库。")).toBeInTheDocument();
});

test("uses the verified account subject unchanged as the personal cloud scope", () => {
  expect(personalLibraryScopeId("8d337604-f670-440a-8f72-aa057b84137d")).toBe("8d337604-f670-440a-8f72-aa057b84137d");
  expect(personalLibraryScopeId("user:development-subject")).toBe("user:development-subject");
  expect(personalLibraryScopeId(undefined)).toBe("");
});

test("keeps a failed personal cloud export visible without reporting success", async () => {
  mockPersonalCollection();
  renderLibraryPane({ accountSessionAvailable: true, accountScopeId: "user_1", onResourceTransfer: vi.fn().mockRejectedValue(new Error("账号已变化，请重新操作。")) });
  fireEvent.contextMenu(await screen.findByRole("button", { name: "Cloud paper", exact: true }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制到本机文献库", exact: true }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "确认资料转移" })).getByRole("button", { name: "确认复制" }));
  expect(await screen.findByText("账号已变化，请重新操作。")).toBeInTheDocument();
  expect(screen.queryByText("已复制到本机文献库。")).not.toBeInTheDocument();
});

test("requires a chosen local library for personal cloud PDF copies", async () => {
  mockPersonalCollection();
  renderLibraryPane({ accountSessionAvailable: true, accountScopeId: "user_1", localLibrarySnapshot: null, onResourceTransfer: vi.fn() });
  fireEvent.contextMenu(await screen.findByRole("button", { name: "Cloud paper", exact: true }));
  expect(await screen.findByRole("menuitem", { name: "复制到本机文献库", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("cancelling the visible copy preview leaves both libraries untouched", async () => {
  mockPersonalCollection();
  const onResourceTransfer = vi.fn();
  renderLibraryPane({ accountSessionAvailable: true, accountScopeId: "user_1", onResourceTransfer });
  fireEvent.contextMenu(await screen.findByRole("button", { name: "Cloud paper", exact: true }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制到本机文献库", exact: true }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "确认资料转移" })).getByRole("button", { name: "取消", exact: true }));
  expect(await screen.findByText("已取消资料转移。")).toBeInTheDocument();
  expect(onResourceTransfer).not.toHaveBeenCalled();
});

test("offers a dedicated bibliography editor from the local paper context menu", async () => {
  const onEditBibliography = vi.fn();
  renderLibraryPane({ fileLibrary: { entries: [{ id: paper.id, title: paper.title, format: "pdf" }], pending: false, message: "",
    onImport: vi.fn(), onInspect: vi.fn(), onOpen: vi.fn(), onEditBibliography } });
  await userEvent.click(screen.getByRole("button", { name: "本地文献库更多操作" }));
  expect(screen.getByText(/本机文件 · 保存在此设备/)).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "收藏更多操作" }));
  expect(screen.getByText("个人云收藏 · 当前账号的云端副本，未因此发布到 Intuecho")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "组织文献库更多操作" }));
  expect(screen.getByText("组织文献 · 访问和下载遵循当前组织权限")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: paper.title, exact: true }) });
  fireEvent.click(await screen.findByRole("menuitem", { name: "编辑元信息", exact: true }));
  expect(onEditBibliography).toHaveBeenCalledWith(expect.objectContaining({ id: paper.id, title: paper.title, format: "pdf" }));
});

test("edits, displays and filters local papers by category and tags", async () => {
  const user = userEvent.setup();
  await savePaperFileMetadata(paper.id, {
    category: "机器学习",
    tags: ["RAG", "向量检索"]
  });
  renderLibraryPane();

  const metadata = await screen.findByLabelText(`${paper.title} 的分类与标签`);
  await user.click(within(metadata).getByRole("button", { name: /展开其余/ }));
  expect(within(metadata).getByText("机器学习")).toBeInTheDocument();
  expect(within(metadata).getByText("向量检索")).toBeInTheDocument();

  await selectPickerValue(screen.getByRole("combobox", { name: "按论文分类筛选" }), "机器学习");
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();

  await user.clear(screen.getByRole("textbox", { name: "搜索文献资源" }));
  await user.type(screen.getByRole("textbox", { name: "搜索文献资源" }), "RAG");
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();

  await user.clear(screen.getByRole("textbox", { name: "搜索文献资源" }));
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: paper.title }) });
  // Pointer movement across the context menu is covered by the browser test;
  // dispatch the action directly here to isolate metadata editing from jsdom motion.
  fireEvent.click(await screen.findByRole("menuitem", { name: "编辑分类与标签" }));
  await screen.findByRole("dialog", { name: "编辑资产分类与标签" });
  // Move focus into the editor after the menu restores focus in jsdom.
  await user.click(screen.getByLabelText("资产分类"));
  fireEvent.change(screen.getByRole("textbox", { name: "资产分类" }), {
    target: { value: "已精读" }
  });
  fireEvent.change(screen.getByRole("textbox", { name: "资产标签" }), {
    target: { value: "检索, 必读" }
  });
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑资产分类与标签" })).not.toBeInTheDocument());
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
  await userEvent.click(screen.getByRole("button", { name: `展开 ${paper.title} 的1 项关联内容` }));
  await userEvent.click(screen.getByRole("button", { name: "打开论文文件：薄读：方法" }));
  expect(open).toHaveBeenCalledWith(child, paper);
});

test("single-click selects without opening and right-click exposes identity confirmation", async () => {
  const open = vi.fn(); const resolve = vi.fn(); const select = vi.fn();
  renderLibraryPane({ onOpenPaper: open, onResolvePaperIdentity: resolve, onToggleSelection: select });
  await userEvent.click(screen.getByRole("button", { name: paper.title }));
  expect(open).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledWith(paper.id);
  expect(screen.queryByRole("menuitem", { name: "确认文献身份" })).not.toBeInTheDocument();
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: paper.title }) });
  await userEvent.click(await screen.findByRole("menuitem", { name: "确认文献身份" }));
  expect(resolve).toHaveBeenCalledWith(paper);
});

test("opens papers on double click while retaining metadata inspection and file filters", async () => {
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
  expect(openPaper).toHaveBeenCalledOnce();
  expect(openPaper).toHaveBeenCalledWith(paper.id);
  await user.type(screen.getByRole("textbox", { name: "搜索文献资源" }), '"Lin Researcher" 10.1234/vector');
  expect(screen.getByRole("button", { name: paper.title, exact: true })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "选择文件 Field Guide" })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索文献资源" }));
  await user.click(screen.getByRole("button", { name: "筛选本地文件" }));
  await selectPickerValue(screen.getByRole("combobox", { name: "筛选文件格式" }), "epub");
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
  expect(screen.queryByRole("button", { name: "打开论文文件：论文文本" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: `展开 ${paper.title} 的3 项关联内容` }));
  expect(screen.queryByRole("button", { name: "打开论文文件：论文文本" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "提取结果", exact: true }));
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
  fireEvent.doubleClick(within(dialog).getByRole("button", { name: paper.title, exact: true }));
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

test("edits semantic facets for an ebook through the same asset editor", async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  renderLibraryPane({ fileLibrary: fileAccess({ entries: [{ id: "book", title: "My Book", format: "epub", authors: ["Jane Austen"] }], onMetadataChange: update }) });
  fireEvent.contextMenu(screen.getByRole("button", { name: "选择文件 My Book" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "编辑分类与标签" }));
  const editor = await screen.findByRole("dialog", { name: "编辑资产分类与标签" });
  expect(within(editor).getByRole("combobox", { name: "资产类别" })).toHaveTextContent("图书");
  fireEvent.change(within(editor).getByRole("textbox", { name: "资产年份" }), { target: { value: "2024" } });
  fireEvent.change(within(editor).getByRole("textbox", { name: "资产学科" }), { target: { value: "文学, 历史" } });
  fireEvent.change(within(editor).getByRole("textbox", { name: "资产标签" }), { target: { value: "经典, 待读" } });
  fireEvent.click(within(editor).getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(update).toHaveBeenCalledWith("book", expect.objectContaining({ assetType: "book", year: 2024,
    authors: ["Jane Austen"], subjects: ["文学", "历史"], tags: ["经典", "待读"] })));
});

test("displays compact facet chips and combines quick tag selection with author filtering", async () => {
  await savePaperFileMetadata(paper.id, { category: "项目", tags: ["必读"], assetType: "journal-article", year: 2024, authors: ["Alice Smith"], subjects: ["机器学习"] });
  renderLibraryPane();
  const chips = await screen.findByLabelText(`${paper.title} 的分类与标签`);
  await userEvent.click(within(chips).getByRole("button", { name: /展开其余/ }));
  expect(within(chips).getByText("期刊论文")).toBeInTheDocument();
  expect(within(chips).getByText("2024")).toBeInTheDocument();
  expect(within(chips).getByRole("button", { name: "作者：Alice Smith" })).toBeInTheDocument();
  fireEvent.click(within(chips).getByText("必读"));
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "筛选本地文件" }));
  fireEvent.change(screen.getByRole("textbox", { name: "筛选作者" }), { target: { value: "Someone Else" } });
  expect(screen.queryByRole("button", { name: paper.title })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重置筛选" }));
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();
});

test("shows a short author label while filtering with the full stored name", async () => {
  await savePaperFileMetadata(paper.id, { authors: ["Ada Lovelace"], year: 2024 });
  renderLibraryPane();
  const chips = await screen.findByLabelText(`${paper.title} 的分类与标签`);
  const author = within(chips).getByRole("button", { name: "作者：Ada Lovelace" });
  expect(author).toHaveTextContent(/^Lovelace$/);
  expect(author).toHaveAttribute("title", "作者：Ada Lovelace");
  fireEvent.click(author);
  fireEvent.click(screen.getByRole("button", { name: "筛选本地文件" }));
  expect(screen.getByRole("textbox", { name: "筛选作者" })).toHaveValue("Ada Lovelace");
  expect(screen.getByRole("button", { name: paper.title })).toBeInTheDocument();
});


test("distinguishes unknown, empty and failed associated content without hiding the disclosure", async () => {
  const view = renderLibraryPane();
  await userEvent.click(screen.getByRole("button", { name: `展开 ${paper.title} 的关联内容尚未查询` }));
  expect(screen.getByText("关联内容尚未查询", { selector: "p[role=status]" })).toBeVisible();
  expect(screen.queryByText("0 项关联内容")).not.toBeInTheDocument();
  view.unmount();
  const retry = vi.fn();
  renderLibraryPane({ paperInventory: { [paper.id]: { state: "error", items: [], summary: "目录权限不足", extraction: "unknown" } }, onRefreshPaperInventory: retry });
  await userEvent.click(screen.getByRole("button", { name: `展开 ${paper.title} 的关联内容读取失败` }));
  expect(screen.getByText("目录权限不足")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "重试关联内容" })); expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText("0 项关联内容")).not.toBeInTheDocument();
});


test("clears local trash only through its named menu and explicit confirmation", async () => {
  const user = userEvent.setup(), empty = vi.spyOn(fileSystem, "emptyLocalLibraryTrash").mockResolvedValue(undefined);
  const refresh = vi.fn(async () => {}), confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  renderLibraryPane({ onRefreshLocalLibrary: refresh, localLibrarySnapshot: {
    entries: [], folders: [], libraryId: "trash-fixture", revision: 1, rootPath: "/library", trashEntries: [{ trashId: "deleted", name: "Synthetic.pdf", nodeType: "document", byteLength: 100, documentCount: 1, originalRelativePath: "Synthetic.pdf", trashedAt: 1, purgeAfter: 2000000000 }]
  } });
  expect(screen.queryByRole("button", { name: "清空本地回收站" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "本地回收站更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "清空本地回收站" }));
  expect(empty).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "本地回收站更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "清空本地回收站" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("无法恢复"));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(empty).toHaveBeenCalledOnce();
});

test("local trash disables repeat actions while pending and keeps a restore failure visible for retry", async () => {
  let reject!: (error: Error) => void;
  const restore = vi.spyOn(fileSystem, "restoreLocalLibraryTrashItem").mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const refresh = vi.fn(async () => {});
  renderLibraryPane({ onRefreshLocalLibrary: refresh, localLibrarySnapshot: {
    entries: [], folders: [], libraryId: "pending-trash", revision: 1, rootPath: "/library", trashEntries: [{ trashId: "deleted", name: "Pending.pdf", nodeType: "document", byteLength: 100, documentCount: 1, originalRelativePath: "Pending.pdf", trashedAt: 1, purgeAfter: 2000000000 }]
  } });
  await userEvent.click(screen.getByRole("button", { name: "回收站", exact: true }));
  const restoreButton = screen.getByRole("button", { name: "恢复 Pending.pdf" });
  fireEvent.click(restoreButton);
  fireEvent.click(restoreButton);
  expect(restore).toHaveBeenCalledOnce();
  expect(restoreButton).toBeDisabled();
  expect(screen.getByRole("button", { name: "永久删除 Pending.pdf" })).toBeDisabled();
  expect(screen.getByText("正在恢复“Pending.pdf”…")).toBeInTheDocument();
  await act(async () => reject(new Error("恢复失败：目标文件已存在。")));
  expect(screen.getByText("恢复失败：目标文件已存在。")).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
  expect(restoreButton).toBeEnabled();
  await userEvent.click(restoreButton);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(restore).toHaveBeenCalledTimes(2);
  expect(screen.getByText("操作已完成。")).toBeInTheDocument();
});

test("cloud trash keeps the scope and revision and reports delayed restore errors", async () => {
  const entry = { ...mockPersonalCollection(), status: "trashed" as const };
  const refresh = vi.fn(async () => {});
  vi.mocked(cloudTree.useCloudLibraryTree).mockImplementation((input) => ({
    message: "", quota: null, refresh, status: "ready", tree: null,
    trashTree: input.scopeType === "user" ? { scopeId: "user_1", scopeType: "user", entries: [entry], folders: [], revision: 7 } : null,
  }));
  let reject!: (error: Error) => void;
  const restore = vi.fn(() => new Promise<cloudStorage.CloudLibraryTree>((_, fail) => { reject = fail; }));
  const createClient = cloudStorage.createCloudLibraryStorageClient;
  vi.spyOn(cloudStorage, "createCloudLibraryStorageClient").mockImplementation((input) => ({ ...createClient(input), restoreDocument: restore }));
  renderLibraryPane({ accountSessionAvailable: true, accountScopeId: "user_1" });
  await userEvent.click(screen.getByRole("button", { name: "回收站", exact: true }));
  const button = screen.getByRole("button", { name: "恢复 Cloud paper" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(restore).toHaveBeenCalledOnce();
  expect(restore).toHaveBeenCalledWith({ scopeId: "user_1", scopeType: "user" }, "cloud_pdf", 7);
  expect(button).toBeDisabled();
  expect(screen.getByText("正在恢复“Cloud paper”…")).toBeInTheDocument();
  await act(async () => reject(new Error("云端版本已变化，请刷新后重试。")));
  expect(screen.getByText("云端版本已变化，请刷新后重试。")).toBeInTheDocument();
  expect(button).toBeEnabled();
  expect(refresh).not.toHaveBeenCalled();
});
