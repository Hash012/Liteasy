import { describe, expect, test } from "vitest";
import { evaluateSemanticPlanPolicy } from "../app/features/agent-runtime/policyEngine";
import type {
  AgentRuntimeContextView,
  SemanticActionPlan
} from "../app/features/agent-runtime/agentRuntime.types";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

function createPlan(overrides: Partial<SemanticActionPlan> = {}): SemanticActionPlan {
  return {
    actions: [],
    confidence: "high",
    intentId: "unknown",
    planId: "policy-plan",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "策略测试计划",
    ...overrides
  };
}

const readyContextView: AgentRuntimeContextView = {
  cloud: {
    connected: true
  },
  profile: {},
  selection: {
    importedCount: 2,
    issues: [],
    locked: true,
    ready: true,
    selectedCount: 2
  },
  workspace: {
    type: "local_library"
  }
};

describe("PolicyEngine", () => {
  test("allows low-risk registered UI actions", () => {
    expect(
      evaluateSemanticPlanPolicy(
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
          contextView: readyContextView,
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      kind: "allow",
      riskLevel: "low"
    });
  });

  test("requires confirmation for registered high-risk actions", () => {
    expect(
      evaluateSemanticPlanPolicy(
        createPlan({
          actions: [
            {
              actionId: "workspace.delete_documents",
              input: {
                scope: "selected_document_set"
              }
            }
          ],
          intentId: "workspace.delete_documents",
          requiresConfirmation: false,
          riskLevel: "low",
          summary: "删除当前选中文献"
        }),
        {
          contextView: readyContextView,
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      action: {
        actionId: "workspace.delete_documents",
        input: {
          scope: "selected_document_set"
        }
      },
      kind: "confirm",
      riskLevel: "high",
      summary: "请确认后再执行：删除当前选中文献"
    });
  });

  test("clarifies when artifact actions lack ready selected-document context", () => {
    expect(
      evaluateSemanticPlanPolicy(
        createPlan({
          actions: [
            {
              actionId: "artifact.generate",
              input: {
                artifactType: "mindmap",
                source: "selected_document_set"
              }
            }
          ],
          intentId: "artifact.generate",
          requiredContext: ["selected_document_set"],
          summary: "生成思维导图"
        }),
        {
          contextView: {
            ...readyContextView,
            selection: {
              importedCount: 0,
              issues: ["selection_empty"],
              locked: false,
              ready: false,
              selectedCount: 0
            }
          },
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      kind: "clarify",
      missing: ["selected_document_set"],
      question: "请先勾选要分析的文献，再生成思维导图。"
    });
  });

  test("denies unsupported or unregistered action plans before execution", () => {
    expect(
      evaluateSemanticPlanPolicy(
        createPlan({
          summary: "当前还不能导出视频",
          unsupportedReason: "未注册 video.export 或等价动作。"
        }),
        {
          contextView: readyContextView,
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      kind: "deny",
      reason: "当前还不能导出视频",
      recovery: "未注册 video.export 或等价动作。"
    });

    expect(
      evaluateSemanticPlanPolicy(
        createPlan({
          actions: [
            {
              actionId: "system.run_shell",
              input: {
                command: "rm -rf ."
              }
            } as never
          ],
          summary: "运行系统命令"
        }),
        {
          contextView: readyContextView,
          registeredActions: getRegisteredActionMetadata()
        }
      )
    ).toEqual({
      kind: "deny",
      reason: "语义计划包含未注册动作。",
      recovery: "Unknown action: system.run_shell"
    });
  });
});
