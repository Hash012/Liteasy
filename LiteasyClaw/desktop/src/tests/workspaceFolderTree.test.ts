import { groupWorkspacePapersByFolder } from "../app/features/workspace/workspaceFolderTree";

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
