import { describe, expect, test } from "vitest";
import type { UIDslDocument, UIDslNode } from "../app/features/generative-ui/generativeUi.types";
import {
  validateUIDslUx,
  validateUIDslUxWithModelFallback
} from "../app/features/generative-ui/uxValidator";

function baseDocument(root: UIDslNode): UIDslDocument {
  return {
    actions: [],
    audit: {
      createdAt: "2026-07-05T00:00:00.000Z",
      generatedBy: "rule",
      traceId: "trace-ux"
    },
    dataSources: [],
    id: "ui-ux",
    intentPlanId: "plan-ux",
    root,
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}

describe("validateUIDslUx", () => {
  test("rejects high-risk primary action styling", () => {
    const result = validateUIDslUx({
      ...baseDocument({
        component: "ActionBar",
        id: "actions",
        props: {
          actionIds: ["delete"],
          primaryActionId: "delete"
        }
      }),
      actions: [
        {
          actionId: "workspace.delete_documents",
          id: "delete",
          input: {
            scope: "selected_document_set"
          },
          label: "删除",
          riskLevel: "high"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("High-risk actions cannot be primary")])
    );
  });

  test("rejects assistant card depth greater than three", () => {
    const result = validateUIDslUx(
      baseDocument({
        children: [
          {
            children: [
              {
                children: [
                  {
                    component: "Panel",
                    id: "too-deep",
                    props: {
                      title: "Too deep"
                    }
                  }
                ],
                component: "Panel",
                id: "level-three",
                props: {
                  title: "Level 3"
                }
              }
            ],
            component: "Panel",
            id: "level-two",
            props: {
              title: "Level 2"
            }
          }
        ],
        component: "Panel",
        id: "level-one",
        props: {
          title: "Level 1"
        }
      })
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Assistant card depth cannot exceed 3")])
    );
  });

  test("rejects long text without a collapse or scroll strategy", () => {
    const result = validateUIDslUx(
      baseDocument({
        component: "Panel",
        id: "long-panel",
        props: {
          text: "长文本".repeat(180),
          title: "Long"
        }
      })
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Long text requires collapse or scroll strategy")])
    );
  });
});

describe("validateUIDslUxWithModelFallback", () => {
  test("rejects a deterministic-valid document when the model UX review flags unreachable controls", async () => {
    const result = await validateUIDslUxWithModelFallback(
      baseDocument({
        component: "ActionBar",
        id: "actions",
        props: {
          actionIds: ["open-profile"]
        }
      }),
      {
        generateModelUxReview: async () =>
          JSON.stringify({
            errors: ["Button unreachable: action bar is hidden behind the workbench overlay"],
            valid: false
          })
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Button unreachable")])
    );
  });

  test("ignores unsafe model UX review payloads and keeps the deterministic result", async () => {
    const result = await validateUIDslUxWithModelFallback(
      baseDocument({
        component: "StatusBanner",
        id: "status",
        props: {
          text: "已生成可用界面。",
          tone: "success"
        }
      }),
      {
        generateModelUxReview: async () =>
          JSON.stringify({
            errors: ["<script>alert('owned')</script>"],
            valid: false
          })
      }
    );

    expect(result).toEqual({
      errors: [],
      valid: true
    });
  });
});
