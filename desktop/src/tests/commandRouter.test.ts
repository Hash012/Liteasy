import { routeCommand } from "../app/features/assistant/commandRouter";

test("maps closing network recommendation to a typed settings command", () => {
  const result = routeCommand("关闭联网推荐");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.change).toEqual({
      intent: "update_setting",
      target: "network.recommendation.enabled",
      value: false,
    });
  }
});

test("maps opening network recommendation", () => {
  const result = routeCommand("开启联网推荐");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.change.value).toBe(true);
  }
});

test("maps closing user profile", () => {
  const result = routeCommand("关闭用户画像");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.change.target).toBe("profile.enabled");
    expect(result.change.value).toBe(false);
  }
});

test("maps default output mode to qa", () => {
  const result = routeCommand("默认输出模式为问答");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.change.target).toBe("assistant.default_output_mode");
    expect(result.change.value).toBe("qa");
  }
});

test("maps language switch", () => {
  const result = routeCommand("使用英文");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.change.target).toBe("assistant.language");
    expect(result.change.value).toBe("en");
  }
});

test("returns failure for unknown command", () => {
  const result = routeCommand("帮我写一篇论文");

  expect(result.ok).toBe(false);
});
