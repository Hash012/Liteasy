import {
  buildWorkspaceFolderTree,
  groupWorkspacePapersByFolder
} from "../app/features/workspace/workspaceFolderTree";

test("groups workspace papers by source parent folders", () => {
  const groups = groupWorkspacePapersByFolder([
    { id: "paper-1", sourcePath: "/papers/colbert-late-interaction.pdf", title: "Attention" },
    { id: "paper-2", sourcePath: "fixtures/transformer/bert.pdf", title: "BERT" },
    { id: "paper-3", sourcePath: "notes.pdf", title: "Loose Note" },
    { id: "paper-4", title: "No Path" }
  ]);

  expect(groups).toEqual([
    {
      folder: "/papers",
      papers: [
        { id: "paper-1", sourcePath: "/papers/colbert-late-interaction.pdf", title: "Attention" }
      ]
    },
    {
      folder: "fixtures/transformer",
      papers: [
        { id: "paper-2", sourcePath: "fixtures/transformer/bert.pdf", title: "BERT" }
      ]
    },
    {
      folder: "未归档文献",
      papers: [
        { id: "paper-3", sourcePath: "notes.pdf", title: "Loose Note" },
        { id: "paper-4", title: "No Path" }
      ]
    }
  ]);
});

test("builds nested folder nodes with descendant paper counts", () => {
  const tree = buildWorkspaceFolderTree([
    { id: "paper-1", sourcePath: "/papers/search/colbert.pdf", title: "ColBERT" },
    { id: "paper-2", sourcePath: "/papers/search/acorn.pdf", title: "ACORN" },
    { id: "paper-3", sourcePath: "/papers/database/survey.pdf", title: "Survey" }
  ]);

  expect(tree).toHaveLength(1);
  expect(tree[0]).toMatchObject({ name: "papers", paperCount: 3, path: "/papers" });
  expect(tree[0].children).toEqual([
    expect.objectContaining({ name: "database", paperCount: 1, path: "/papers/database" }),
    expect.objectContaining({ name: "search", paperCount: 2, path: "/papers/search" })
  ]);
});

test("collapses absolute parent segments into the configured workspace root", () => {
  const tree = buildWorkspaceFolderTree(
    [
      {
        id: "paper-1",
        sourcePath: "/home/test/LiteasyLibrary/papers/search/colbert.pdf",
        title: "ColBERT"
      }
    ],
    "/home/test/LiteasyLibrary"
  );

  expect(tree).toHaveLength(1);
  expect(tree[0]).toMatchObject({
    name: "LiteasyLibrary",
    paperCount: 1,
    path: "/home/test/LiteasyLibrary"
  });
  expect(tree[0].children[0]).toMatchObject({
    name: "papers",
    path: "/home/test/LiteasyLibrary/papers"
  });
});
