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

test("maps disabling profile sampling to a settings skill invocation", () => {
  const result = routeCommand("关闭用户画像");

  expect(result).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "profile.enabled",
      value: false
    }
  });
});

test("routes model-policy commands to safe settings skills", () => {
  expect(routeCommand("允许本地直连")).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.local_direct_enabled",
      value: true
    }
  });

  expect(routeCommand("切换到本地直连")).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.access_mode",
      value: "local_direct"
    }
  });

  expect(routeCommand("切换到云代理")).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "models.access_mode",
      value: "cloud_proxy"
    }
  });

  expect(routeCommand("同步云端策略")).toEqual({
    skillId: "settings.sync_policy",
    input: {
      source: "cloud_control_plane"
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




test("does not expose endpoint-switching commands to normal assistant routing", () => {
  expect(routeCommand("使用本地开发云端点")).toBeNull();
  expect(routeCommand("把端点恢复到本地开发云")).toBeNull();
  expect(routeCommand("设置云代理端点为 http://127.0.0.1:8787")).toBeNull();
  expect(routeCommand("设置云端控制平面端点为 http://127.0.0.1:8787")).toBeNull();
});

test("maps natural language command aliases to safe actions", () => {
  expect(routeCommand("帮我打开组织的共享文献库")).toEqual({
    skillId: "organization.open_shared_library",
    input: {
      source: "organization_space"
    }
  });

  expect(routeCommand("请帮我同步一下云端模型策略")).toEqual({
    skillId: "settings.sync_policy",
    input: {
      source: "cloud_control_plane"
    }
  });

  expect(routeCommand("别再联网推荐了")).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "network.recommendation.enabled",
      value: false
    }
  });

  expect(routeCommand("重新开启联网文献推荐")).toEqual({
    skillId: "settings.adjust",
    input: {
      target: "network.recommendation.enabled",
      value: true
    }
  });
});

test("maps opening the organization shared library to an organization skill invocation", () => {
  const result = routeCommand("打开组织共享文献库");

  expect(result).toEqual({
    skillId: "organization.open_shared_library",
    input: {
      source: "organization_space"
    }
  });
});
