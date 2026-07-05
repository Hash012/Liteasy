import { describe, expect, test } from "vitest";
import {
  createRecoverableActionFailure,
  evaluateSmoothExecutionPolicy
} from "../app/features/agent-runtime/smoothPolicy";
import type { SemanticActionPlan } from "../app/features/agent-runtime/agentRuntime.types";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

function createPlan(overrides: Partial<SemanticActionPlan> = {}): SemanticActionPlan {
  return {
    actions: [],
    confidence: "high",
    intentId: "unknown",
    planId: "smooth-plan",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "丝滑执行测试",
    ...overrides
  };
}

describe("SmoothPolicy", () => {
  test("runs low-latency UI actions immediately", () => {
    expect(
      evaluateSmoothExecutionPolicy(
        createPlan({
          actions: [
            {
              actionId: "theme.apply_preset",
              input: {
                preset: "playful",
                tone: "cartoon"
              }
            }
          ],
          intentId: "theme.apply",
          summary: "应用卡通风格"
        }),
        {
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      kind: "immediate"
    });
  });

  test("backgrounds long-running artifact work through progress and task lifecycle", () => {
    expect(
      evaluateSmoothExecutionPolicy(
        createPlan({
          actions: [
            {
              actionId: "artifact.generate",
              input: {
                artifactType: "tree",
                source: "selected_document_set"
              }
            }
          ],
          intentId: "artifact.generate",
          summary: "生成树状图"
        }),
        {
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      action: {
        actionId: "artifact.generate",
        input: {
          artifactType: "tree",
          source: "selected_document_set"
        }
      },
      kind: "background",
      progressEvents: ["progress_started", "task_created"],
      taskId: "task-smooth-plan",
      taskType: "artifact.generate"
    });
  });

  test("creates recoverable failure details for disconnected action handlers", () => {
    expect(
      createRecoverableActionFailure(
        createPlan({
          summary: "应用卡通风格"
        }),
        {
          actionId: "theme.apply_preset",
          input: {
            preset: "playful",
            tone: "cartoon"
          }
        },
        "UI 动作执行能力尚未注册。"
      )
    ).toEqual({
      message: "UI 动作执行能力尚未注册。",
      recovery: "请检查 应用卡通风格 的 theme.apply_preset action 是否已连接。"
    });
  });
});
