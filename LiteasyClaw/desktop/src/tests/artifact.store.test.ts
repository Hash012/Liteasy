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
