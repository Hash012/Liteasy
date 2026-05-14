import { createWorkspaceStore } from "../app/features/workspace/workspace.store";

test("locks selected papers after workspace lock", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Paper 1", filePath: "/tmp/p1.pdf" });
  store.addPaper({ id: "p2", title: "Paper 2", filePath: "/tmp/p2.pdf" });
  store.toggleSelection("p1");
  store.lockSelection();
  store.toggleSelection("p2");

  expect(store.getState().selectedPaperIds).toEqual(["p1"]);
  expect(store.getState().selectionLocked).toBe(true);
});

test("stores and retrieves paper content", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Test", filePath: "/tmp/test.pdf" });
  store.setPaperContent("p1", {
    fullText: "Hello world.",
    pageCount: 1,
    importedAt: "2026-05-12T00:00:00Z",
  });

  expect(store.getPaper("p1")?.content?.fullText).toBe("Hello world.");
  expect(store.getPaper("p1")?.content?.pageCount).toBe(1);
});

test("sets and retrieves active paper", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Paper", filePath: "/tmp/p1.pdf" });
  store.setActivePaper("p1");

  expect(store.getState().activePaperId).toBe("p1");
});
