import { createArtifactStore } from "../app/features/artifacts/artifact.store";

test("completes a mind-map artifact task and opens a new tab", () => {
  const store = createArtifactStore();
  const taskId = store.createTask("mindmap");

  store.completeTask(taskId, {
    artifactId: "a1",
    title: "Transformer Mind Map",
    content: "mind map content",
  });

  expect(store.getTask(taskId)?.status).toBe("completed");
  expect(store.getOpenTabs().find((t) => t.artifactId === "a1")).toBeTruthy();
});

test("starts with a default reader tab", () => {
  const store = createArtifactStore();
  expect(store.getOpenTabs()).toHaveLength(1);
  expect(store.getOpenTabs()[0].id).toBe("reader-default");
});

test("task goes through status lifecycle", () => {
  const store = createArtifactStore();
  const taskId = store.createTask("tree");

  expect(store.getTask(taskId)?.status).toBe("queued");

  store.markRunning(taskId);
  expect(store.getTask(taskId)?.status).toBe("running");

  store.markFailed(taskId);
  expect(store.getTask(taskId)?.status).toBe("failed");
});
