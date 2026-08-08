import { createWorkspaceStore } from "../app/features/workspace/workspace.store";

test("locks selected papers after workspace lock", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Paper 1" });
  store.addPaper({ id: "p2", title: "Paper 2" });
  store.toggleSelection("p1");
  store.lockSelection();
  store.toggleSelection("p2");

  expect(store.getState().selectedPaperIds).toEqual(["p1"]);
  expect(store.getState().selectionLocked).toBe(true);
});

test("builds a selected document set from locked papers", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Paper 1" });
  store.addPaper({ id: "p2", title: "Paper 2" });
  store.toggleSelection("p1");
  store.toggleSelection("p2");
  store.lockSelection();

  expect(store.getSelectedDocumentSet()).toEqual({
    documentIds: ["p1", "p2"],
    locked: true
  });
});

test("does not add the same paper twice", () => {
  const store = createWorkspaceStore();

  expect(store.addPaper({ id: "p1", title: "Paper 1" })).toBe(true);
  expect(store.addPaper({ id: "p1", title: "Paper 1" })).toBe(false);

  expect(store.getState().papers).toEqual([{ id: "p1", title: "Paper 1" }]);
});

test("updates paper paths while preserving stable ids and selection", () => {
  const store = createWorkspaceStore();
  store.addPaper({ id: "p1", sourcePath: "/library/old.pdf", title: "Old" });
  store.toggleSelection("p1");

  store.updatePapers([
    { id: "p1", sourcePath: "/library/archive/new.pdf", title: "New" }
  ]);

  expect(store.getState()).toMatchObject({
    papers: [{ id: "p1", sourcePath: "/library/archive/new.pdf", title: "New" }],
    selectedPaperIds: ["p1"],
    workspaceRevision: 1
  });
});

test("closes the visible workspace and resets document selection", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Paper 1" });
  store.addPaper({ id: "p2", title: "Paper 2" });
  store.toggleSelection("p1");
  store.lockSelection();
  store.closeWorkspace();

  expect(store.getState()).toEqual({
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false,
    workspaceSource: {
      rootPath: "本地文献库",
      type: "local_library"
    },
    workspaceRevision: 1
  });
});
