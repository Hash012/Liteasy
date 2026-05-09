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
