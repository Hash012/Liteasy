import { createArtifactStore } from "../app/features/artifacts/artifact.store";

test("completes a mind-map artifact task and opens a new tab", () => {
  const store = createArtifactStore();
  const taskId = store.createTask("mindmap");

  store.completeTask(taskId, {
    artifactId: "a1",
    title: "Literature Mind Map",
    type: "mindmap"
  });

  expect(store.getTask(taskId)?.status).toBe("completed");
  expect(store.getOpenTabs()[0]?.artifactId).toBe("a1");
});

test("opens a distinct tab for a tree analysis task", () => {
  const store = createArtifactStore();
  const taskId = store.createTask("tree");

  store.completeTask(taskId, {
    artifactId: "a2",
    title: "Literature Tree Analysis",
    type: "tree"
  });

  expect(store.getTask(taskId)?.type).toBe("tree");
  expect(store.getOpenTabs()[0]?.type).toBe("tree");
});

test("keeps every concurrent generation task in newest-first order", () => {
  const store = createArtifactStore();
  const firstTaskId = store.createTask("mindmap");
  const secondTaskId = store.createTask("tree");

  store.startTask(firstTaskId);
  store.startTask(secondTaskId);
  store.updateTask(firstTaskId, { progress: 42 });

  expect(store.getTasks()).toEqual([
    expect.objectContaining({ id: secondTaskId, progress: 15, status: "running" }),
    expect.objectContaining({ id: firstTaskId, progress: 42, status: "running" })
  ]);
});

test("keeps generated artifact history after a tab is closed and can reopen it", () => {
  const store = createArtifactStore();
  const firstTaskId = store.createTask("mindmap");
  const secondTaskId = store.createTask("ppt");

  store.completeTask(firstTaskId, {
    artifactId: "artifact-1",
    title: "Literature Mind Map",
    type: "mindmap"
  });
  store.completeTask(secondTaskId, {
    artifactId: "artifact-2",
    title: "Literature PPT Outline",
    type: "ppt"
  });

  expect(store.getOpenTabs().map((tab) => tab.artifactId)).toEqual([
    "artifact-2",
    "artifact-1"
  ]);

  store.closeTab("artifact-2");

  expect(store.getOpenTabs().map((tab) => tab.artifactId)).toEqual(["artifact-1"]);
  expect(store.getCatalog().map((tab) => tab.artifactId).sort()).toEqual([
    "artifact-1",
    "artifact-2"
  ]);

  expect(store.openCatalogEntry("artifact-2")).toBe(true);
  expect(store.getOpenTabs().map((tab) => tab.artifactId)).toEqual([
    "artifact-2",
    "artifact-1"
  ]);
});
