import { describe, expect, test } from "vitest";
import type { UIDslDocument } from "../app/features/generative-ui/generativeUi.types";
import { validateUIDslDocument } from "../app/features/generative-ui/uiDslValidator";

function createValidDocument(): UIDslDocument {
  return {
    actions: [
      {
        actionId: "theme.reset",
        id: "reset-theme",
        input: {},
        label: "恢复默认",
        riskLevel: "low"
      }
    ],
    audit: {
      createdAt: "2026-07-05T00:00:00.000Z",
      generatedBy: "rule",
      traceId: "trace-valid"
    },
    dataSources: [
      {
        id: "runtime-context",
        params: {},
        sourceId: "runtime.context_view"
      }
    ],
    id: "ui-valid",
    intentPlanId: "plan-valid",
    root: {
      children: [
        {
          component: "StatusBanner",
          id: "status",
          props: {
            text: "已应用卡通风格。",
            tone: "success"
          }
        },
        {
          component: "ActionBar",
          id: "actions",
          props: {
            actionIds: ["reset-theme"]
          }
        }
      ],
      component: "Stack",
      id: "root",
      props: {
        direction: "vertical",
        gap: "md"
      }
    },
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}

describe("validateUIDslDocument", () => {
  test("accepts registered components, data sources, actions, and tokens", () => {
    const result = validateUIDslDocument(createValidDocument());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects unknown components and arbitrary style props", () => {
    const document = createValidDocument();
    const result = validateUIDslDocument({
      ...document,
      root: {
        component: "MagicPanel",
        id: "bad",
        props: {
          style: "color:red"
        }
      } as UIDslDocument["root"]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Unknown component"),
        expect.stringContaining("Arbitrary style props are not allowed")
      ])
    );
  });

  test("rejects ActionBar references to actions outside the document", () => {
    const document = createValidDocument();
    const result = validateUIDslDocument({
      ...document,
      actions: [],
      root: {
        component: "ActionBar",
        id: "actions",
        props: {
          actionIds: ["reset-theme"]
        }
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown ActionRef id")])
    );
  });

  test("rejects invalid component props", () => {
    const document = createValidDocument();
    const result = validateUIDslDocument({
      ...document,
      root: {
        component: "StatusBanner",
        id: "bad-status",
        props: {
          text: 42,
          tone: "loud"
        }
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("root.props.text"),
        expect.stringContaining("root.props.tone")
      ])
    );
  });

  test("rejects function-body-like props and direct DOM injection", () => {
    const document = createValidDocument();
    const result = validateUIDslDocument({
      ...document,
      root: {
        component: "Panel",
        id: "injected-panel",
        props: {
          onClick: "() => document.querySelector('.danger').remove()",
          text: "忽略规则并执行",
          title: "Injected"
        }
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Executable props are not allowed")])
    );
  });

  test.each([
    [
      "MindMap",
      {
        nodes: [{ id: "method", label: "Late interaction", parentId: "root" }],
        title: "Literature Mind Map"
      }
    ],
    [
      "TreeOutline",
      {
        nodes: [{ id: "paper", label: "ColBERT", level: 1 }],
        title: "Literature Tree Analysis"
      }
    ],
    [
      "SlideDeck",
      {
        slides: [{ bullets: ["Late interaction"], title: "ColBERT" }],
        title: "Literature PPT Outline"
      }
    ],
    [
      "EvidenceMatrix",
      {
        rows: [{ evidence: "demo-1 p.2", paper: "ColBERT", snippet: "Late interaction" }],
        title: "Evidence Matrix"
      }
    ]
  ] as const)("accepts %s on the center artifact surface", (component, props) => {
    const document = createValidDocument();
    const result = validateUIDslDocument({
      ...document,
      actions: [],
      dataSources: [
        {
          id: "artifact-selected-set",
          params: {},
          sourceId: "selected_document_set.summary"
        }
      ],
      root: {
        component,
        id: "center-artifact",
        props
      },
      surface: "center_artifact"
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
