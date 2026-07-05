import { describe, expect, test } from "vitest";
import { matchSemanticActionCandidates } from "../app/features/agent-runtime/semanticActionMatcher";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

describe("matchSemanticActionCandidates", () => {
  test("returns multiple organization candidates for a broad organization goal", () => {
    const result = matchSemanticActionCandidates("打开组织", {
      registeredActions: getRegisteredActionMetadata()
    });

    expect(result.kind).toBe("ambiguous_action");
    expect(result.candidates).toEqual([
      {
        actionId: "panel.open",
        input: {
          panel: "organization"
        },
        label: "打开组织面板"
      },
      {
        actionId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        },
        label: "打开组织共享文献库"
      }
    ]);
  });

  test("resolves academic archive goals to the registered profile action", () => {
    const result = matchSemanticActionCandidates("打开学术人格里的学术档案", {
      registeredActions: getRegisteredActionMetadata()
    });

    expect(result.kind).toBe("action");
    expect(result.action).toEqual({
      actionId: "profile.open_academic_archive",
      input: {}
    });
  });

  test("resolves non-literal organization library wording through semantic concepts", () => {
    const result = matchSemanticActionCandidates("带我去团队资料区", {
      registeredActions: getRegisteredActionMetadata()
    });

    expect(result).toMatchObject({
      action: {
        actionId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      },
      kind: "action",
      summary: "打开组织共享文献库"
    });
  });

  test("separates non-command text from unsupported command goals", () => {
    expect(
      matchSemanticActionCandidates("ABC", {
        registeredActions: getRegisteredActionMetadata()
      })
    ).toMatchObject({
      kind: "not_command"
    });

    expect(
      matchSemanticActionCandidates("导出一段视频讲解", {
        registeredActions: getRegisteredActionMetadata()
      })
    ).toMatchObject({
      kind: "unsupported_action",
      unsupportedReason: "未注册 video.export 或等价动作。"
    });
  });
});
