import {
  loadAgentPersonalization,
  saveAgentPersonalization
} from "../app/features/agent-core/agentPersonalization";

test("persists editable Agent memories and recent-state override locally", () => {
  window.localStorage.clear();

  saveAgentPersonalization({
    memories: [{
      id: "memory-test",
      importance: "高",
      namespace: "local-user",
      summary: "先给出简洁结论，再补充依据。",
      type: "偏好"
    }],
    recentStateOverride: "用户正在比较两篇检索增强生成论文。"
  });

  expect(loadAgentPersonalization()).toEqual({
    memories: [{
      id: "memory-test",
      importance: "高",
      namespace: "local-user",
      summary: "先给出简洁结论，再补充依据。",
      type: "偏好"
    }],
    recentStateOverride: "用户正在比较两篇检索增强生成论文。"
  });
});
