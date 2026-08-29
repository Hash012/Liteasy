import { describe, expect, test } from "vitest";
import { previewAgentWorkText, summarizeAgentActivity } from "../app/features/assistant/agentActivityPresentation";
import type { AgentActivity } from "../app/features/assistant/assistant.types";

describe("agentActivityPresentation", () => {
  test("keeps the head and tail of long output in the compact projection", () => {
    const preview = previewAgentWorkText("first\nsecond\nthird\nfourth\nfifth\nsixth\nfinal", 5);

    expect(preview.text).toContain("first");
    expect(preview.text).toContain("final");
    expect(preview.text).toContain("省略 3 行");
    expect(preview.omittedLines).toBe(3);
  });

  test("summarizes activity by semantic entry kind", () => {
    const activity: AgentActivity = {
      entries: [
        { id: "tool", kind: "tool", label: "检索", status: "completed" },
        { id: "analysis", kind: "analysis", label: "分析", status: "completed" },
        { id: "output", kind: "output", label: "输出", status: "completed" }
      ],
      generatedContent: "",
      status: "completed",
      statusText: "已完成"
    };

    expect(summarizeAgentActivity(activity)).toBe("1 个工具调用 · 1 条分析 · 1 条输出");
  });
});
