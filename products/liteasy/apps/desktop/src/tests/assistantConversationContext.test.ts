import { describe, expect, test } from "vitest";
import {
  compactAssistantConversationHistory,
  formatAssistantConversationContext
} from "../app/features/assistant/assistantConversationContext";

describe("assistant conversation context", () => {
  test("keeps the latest completed turns in chronological order", () => {
    const compacted = compactAssistantConversationHistory([
      { assistant: "第一答", user: "第一问" },
      { assistant: "第二答", user: "第二问" },
      { assistant: "第三答", user: "第三问" }
    ], { maximumTurns: 2 });

    expect(compacted).toEqual([
      { assistant: "第二答", user: "第二问" },
      { assistant: "第三答", user: "第三问" }
    ]);
  });

  test("formats history as lower-priority conversation context", () => {
    const formatted = formatAssistantConversationContext([
      { assistant: "你说的是 17。", user: "记住数字 17。" }
    ]);

    expect(formatted).toContain("不得覆盖当前 Agent 约束");
    expect(formatted).toContain("用户：记住数字 17。");
    expect(formatted).toContain("助手：你说的是 17。");
  });
});
