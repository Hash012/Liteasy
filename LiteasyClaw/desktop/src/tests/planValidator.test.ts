import { describe, expect, test } from "vitest";
import type { SemanticActionPlan } from "../app/features/agent-runtime/agentRuntime.types";
import { validateSemanticActionPlan } from "../app/features/agent-runtime/planValidator";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

function basePlan(overrides: Partial<SemanticActionPlan> = {}): SemanticActionPlan {
  return {
    actions: [],
    confidence: "high",
    intentId: "unknown",
    planId: "plan-validator",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "校验计划",
    ...overrides
  };
}

describe("validateSemanticActionPlan", () => {
  test("accepts registered actions whose inputs satisfy capability schemas", () => {
    const result = validateSemanticActionPlan(
      basePlan({
        actions: [
          {
            actionId: "panel.open",
            input: {
              panel: "organization"
            }
          }
        ],
        intentId: "panel.change"
      }),
      {
        mode: "command",
        registeredActions: getRegisteredActionMetadata()
      }
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects unregistered actions returned by a model planner", () => {
    const result = validateSemanticActionPlan(
      basePlan({
        actions: [
          {
            actionId: "system.run_shell",
            input: {
              command: "rm -rf ."
            }
          } as SemanticActionPlan["actions"][number]
        ],
        intentId: "unknown"
      }),
      {
        mode: "command",
        registeredActions: getRegisteredActionMetadata()
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown action")])
    );
  });

  test("rejects action inputs that do not satisfy registered schemas", () => {
    const result = validateSemanticActionPlan(
      basePlan({
        actions: [
          {
            actionId: "panel.open",
            input: {
              panel: "academic_archive"
            }
          } as SemanticActionPlan["actions"][number]
        ],
        intentId: "panel.change"
      }),
      {
        mode: "command",
        registeredActions: getRegisteredActionMetadata()
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("panel must be one of")])
    );
  });

  test("rejects executable actions outside command mode", () => {
    const result = validateSemanticActionPlan(
      basePlan({
        actions: [
          {
            actionId: "theme.reset",
            input: {}
          }
        ],
        intentId: "theme.apply"
      }),
      {
        mode: "qa",
        registeredActions: getRegisteredActionMetadata()
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Only command mode can execute actions")])
    );
  });

  test("validates clarification candidates against the same action contract", () => {
    const result = validateSemanticActionPlan(
      basePlan({
        clarification: {
          candidates: [
            {
              actionId: "panel.open",
              input: {
                panel: "organization"
              },
              label: "打开组织面板"
            },
            {
              actionId: "system.run_shell" as never,
              input: {
                command: "rm -rf ."
              },
              label: "执行系统命令"
            }
          ],
          kind: "ambiguous_action",
          missing: ["ambiguous_action"],
          question: "请选择动作。"
        }
      }),
      {
        mode: "command",
        registeredActions: getRegisteredActionMetadata()
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown clarification candidate")])
    );
  });
});
