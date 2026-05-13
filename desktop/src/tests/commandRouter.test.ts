import { routeCommand } from "../app/features/assistant/commandRouter";

test("maps closing network recommendation to a settings skill invocation", () => {
  const result = routeCommand("关闭联网推荐");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "network.recommendation.enabled",
      value: false
    }
  });
});

test("maps generating a mind map to an artifact skill invocation", () => {
  const result = routeCommand("请根据当前选中文献集生成思维导图");

  expect(result).toEqual({
    skillId: "artifact.generate",
    input: {
      artifactType: "mindmap",
      source: "selected_document_set"
    }
  });
});

test("maps enabling local direct model access to a settings skill invocation", () => {
  const result = routeCommand("允许本地直连");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.local_direct_enabled",
      value: true
    }
  });
});

test("maps switching to local direct mode to a settings skill invocation", () => {
  const result = routeCommand("切换到本地直连");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.access_mode",
      value: "local_direct"
    }
  });
});

test("maps syncing cloud policy to a dedicated settings skill invocation", () => {
  const result = routeCommand("同步云端策略");

  expect(result).toEqual({
    skillId: "settings.sync_policy",
    input: {
      source: "cloud_control_plane"
    }
  });
});

test("maps setting the cloud proxy endpoint to a typed settings skill invocation", () => {
  const result = routeCommand("设置云代理端点为 http://127.0.0.1:8787");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.cloud_proxy_endpoint",
      value: "http://127.0.0.1:8787"
    }
  });
});

test("maps setting the control plane endpoint to a typed settings skill invocation", () => {
  const result = routeCommand("设置云端控制平面端点为 http://127.0.0.1:8787");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.control_plane_endpoint",
      value: "http://127.0.0.1:8787"
    }
  });
});

test("maps sorting recommendations by relevance to a settings skill invocation", () => {
  const result = routeCommand("按关联度排序推荐");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "network.recommendation.sort_mode",
      value: "relevance"
    }
  });
});

test("maps sorting recommendations by retrieval time to a settings skill invocation", () => {
  const result = routeCommand("按检索时间排序推荐");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "network.recommendation.sort_mode",
      value: "retrieved_at"
    }
  });
});
