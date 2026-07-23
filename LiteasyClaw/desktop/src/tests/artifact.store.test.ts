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

test("preserves detailed failure diagnostics on a failed task", () => {
  const store = createArtifactStore();
  const taskId = store.createTask("tree");
  store.startTask(taskId);
  store.updateTask(taskId, { stage: "generating_answer" });

  store.failTask(taskId, {
    endpoint: "http://127.0.0.1:8787",
    failedStage: "generating_answer",
    message: "模型服务请求失败（cloud_proxy 502）",
    model: "gpt-5.5",
    occurredAt: "2026-07-21T03:00:00.000Z",
    provider: "openai",
    recovery: ["检查 dev-cloud 配置。"]
  });

  expect(store.getTask(taskId)).toMatchObject({
    failure: {
      endpoint: "http://127.0.0.1:8787",
      failedStage: "generating_answer",
      model: "gpt-5.5",
      provider: "openai"
    },
    message: "Agent 分析失败：模型服务请求失败（cloud_proxy 502）",
    stage: "failed",
    status: "failed"
  });
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
