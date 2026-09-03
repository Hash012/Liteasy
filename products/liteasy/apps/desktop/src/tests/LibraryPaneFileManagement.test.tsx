import { render, screen, waitFor, within } from "@testing-library/react";
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

function renderLibraryPane() {
  return render(
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
    />
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
  await user.click(screen.getByRole("button", { name: paper.title }));
  await user.click(await screen.findByRole("menuitem", { name: "编辑分类与标签" }));
  const dialog = screen.getByRole("dialog", { name: "编辑论文分类与标签" });
  await user.clear(within(dialog).getByRole("textbox", { name: "论文分类" }));
  await user.type(within(dialog).getByRole("textbox", { name: "论文分类" }), "已精读");
  await user.clear(within(dialog).getByRole("textbox", { name: "论文标签" }));
  await user.type(within(dialog).getByRole("textbox", { name: "论文标签" }), "检索, 必读");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑论文分类与标签" })).not.toBeInTheDocument());
  const updatedMetadata = await screen.findByLabelText(`${paper.title} 的分类与标签`);
  expect(within(updatedMetadata).getByText("已精读")).toBeInTheDocument();
  expect(within(updatedMetadata).getByText("必读")).toBeInTheDocument();
});
