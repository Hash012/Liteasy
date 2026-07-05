import { describe, expect, test } from "vitest";
import { createExecutionJournal } from "../app/features/generative-ui/executionJournal";
import { executeUIDslActionRef } from "../app/features/agent-runtime/dynamicActionExecutor";
import { executeSemanticPlan } from "../app/features/agent-runtime/planExecutor";
import { runAgentRuntime } from "../app/features/agent-runtime/runtimeOrchestrator";

describe("createExecutionJournal", () => {
  test("records facts by trace id in append order", () => {
    const journal = createExecutionJournal();

    journal.record({
      planId: "plan-1",
      traceId: "trace-1",
      type: "plan"
    });
    journal.record({
      actionId: "theme.apply_preset",
      result: "allow",
      traceId: "trace-1",
      type: "policy"
    });

    expect(journal.getTrace("trace-1")).toMatchObject([
      {
        planId: "plan-1",
        traceId: "trace-1",
        type: "plan"
      },
      {
        actionId: "theme.apply_preset",
        result: "allow",
        traceId: "trace-1",
        type: "policy"
      }
    ]);
  });

  test("returns immutable trace snapshots", () => {
    const journal = createExecutionJournal();
    journal.record({
      traceId: "trace-immutable",
      type: "ui_dsl",
      uiDslId: "ui-1"
    });

    const trace = journal.getTrace("trace-immutable");
    trace.push({
      traceId: "trace-immutable",
      type: "action_result"
    });

    expect(journal.getTrace("trace-immutable")).toHaveLength(1);
  });

  test("runtime records plan, policy, action result, and ui dsl facts", async () => {
    const journal = createExecutionJournal();

    await executeSemanticPlan(
      {
        actions: [
          {
            actionId: "theme.apply_preset",
            input: {
              preset: "playful",
              tone: "cartoon"
            }
          }
        ],
        confidence: "high",
        intentId: "theme.apply",
        planId: "plan-journal",
        requiredContext: [],
        requiresConfirmation: false,
        riskLevel: "low",
        summary: "应用卡通风格"
      },
      {
        applyThemePreset: () => "已应用卡通风格。",
        journal
      }
    );

    expect(journal.getTrace("trace-plan-journal").map((entry) => entry.type)).toEqual([
      "plan",
      "policy",
      "action_result",
      "ui_dsl"
    ]);
  });

  test("runtime records original command input on the semantic plan trace", async () => {
    const journal = createExecutionJournal();

    await runAgentRuntime(
      {
        message: "让 UI 变成卡通风格",
        mode: "command"
      },
      {
        applyThemePreset: () => "已应用卡通风格。",
        journal,
        semanticPlanner: () => ({
          actions: [
            {
              actionId: "theme.apply_preset",
              input: {
                preset: "playful",
                tone: "cartoon"
              }
            }
          ],
          confidence: "high",
          intentId: "theme.apply",
          planId: "plan-journal-input",
          requiredContext: [],
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "应用卡通风格"
        })
      }
    );

    expect(journal.getTrace("trace-plan-journal-input")[0]).toMatchObject({
      input: "让 UI 变成卡通风格",
      mode: "command",
      traceId: "trace-plan-journal-input",
      type: "input"
    });
  });

  test("action ref routing records dynamic action results", async () => {
    const journal = createExecutionJournal();

    await executeUIDslActionRef(
      {
        actionId: "theme.reset",
        id: "reset-theme",
        input: {},
        label: "恢复默认",
        riskLevel: "low"
      },
      {
        applyThemePreset: () => "已恢复默认界面风格。",
        journal
      },
      {
        traceId: "trace-action-ref"
      }
    );

    expect(journal.getTrace("trace-action-ref")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planId: "action-ref",
          type: "plan"
        }),
        expect.objectContaining({
          actionId: "theme.reset",
          result: "allow",
          type: "policy"
        }),
        expect.objectContaining({
          actionId: "theme.reset",
          message: "已恢复默认界面风格。",
          type: "action_result"
        }),
        expect.objectContaining({
          type: "ui_dsl",
          uiDslId: "ui-action-ref"
        })
      ])
    );
  });
});
