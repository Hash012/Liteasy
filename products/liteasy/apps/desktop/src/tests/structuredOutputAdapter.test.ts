import { describe, expect, test } from "vitest";
import { parseStructuredPlannerPayload } from "../app/features/agent-runtime/structuredOutputAdapter";

describe("parseStructuredPlannerPayload", () => {
  test("parses raw and fenced JSON objects from model output", () => {
    expect(parseStructuredPlannerPayload('{"intentId":"theme.apply"}')).toEqual({
      intentId: "theme.apply"
    });

    expect(parseStructuredPlannerPayload('```json\n{"intentId":"panel.change"}\n```')).toEqual({
      intentId: "panel.change"
    });
  });

  test("rejects structured output that is not a JSON object", () => {
    expect(() => parseStructuredPlannerPayload('"not-object"')).toThrow(
      "模型 planner 返回的 JSON 不是对象。"
    );
  });
});
