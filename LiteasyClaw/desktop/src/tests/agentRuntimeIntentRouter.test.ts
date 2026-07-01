import { routeAgentIntent } from "../app/features/agent-runtime/intentRouter";

test("maps closing network recommendation to a runtime settings plan", () => {
  expect(routeAgentIntent({ message: "关闭联网推荐", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    }
  });
});

test("maps recommendation sort commands to runtime settings plans", () => {
  expect(routeAgentIntent({ message: "按关联度排序推荐", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.sort_mode",
        value: "relevance"
      }
    }
  });

  expect(routeAgentIntent({ message: "按检索时间排序推荐", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.sort_mode",
        value: "retrieved_at"
      }
    }
  });
});

test("maps profile sampling commands to runtime settings plans", () => {
  expect(routeAgentIntent({ message: "开启用户画像", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "profile.enabled",
        value: true
      }
    }
  });
});

test("maps organization shared library commands to runtime organization plans", () => {
  expect(routeAgentIntent({ message: "帮我打开组织的共享文献库", mode: "command" })).toEqual({
    intentId: "organization.open_shared_library",
    kind: "skill",
    skill: {
      skillId: "organization.open_shared_library",
      input: {
        source: "organization_space"
      }
    }
  });
});

test("maps mind map commands to runtime artifact plans", () => {
  expect(routeAgentIntent({ message: "请根据当前选中文献集生成思维导图", mode: "command" })).toEqual({
    artifact: {
      artifactType: "mindmap",
      payload: {
        source: "selected_document_set"
      }
    },
    intentId: "artifact.generate",
    kind: "artifact"
  });
});

test("does not expose removed endpoint or model-policy commands", () => {
  expect(routeAgentIntent({ message: "允许本地直连", mode: "command" })).toEqual({
    intentId: "unknown",
    kind: "unknown",
    message: "当前命令还没有注册到安全能力表中。"
  });
  expect(routeAgentIntent({ message: "设置云代理端点为 http://127.0.0.1:8787", mode: "command" })).toEqual({
    intentId: "unknown",
    kind: "unknown",
    message: "当前命令还没有注册到安全能力表中。"
  });
});

test("treats non-command modes as unknown for command routing", () => {
  expect(routeAgentIntent({ message: "关闭联网推荐", mode: "qa" })).toEqual({
    intentId: "unknown",
    kind: "unknown",
    message: "当前模式不执行受控命令。"
  });
});
