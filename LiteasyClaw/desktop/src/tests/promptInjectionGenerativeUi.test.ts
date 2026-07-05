import { describe, expect, test } from "vitest";
import type { UIDslDocument } from "../app/features/generative-ui/generativeUi.types";
import { validateUIDslDocument } from "../app/features/generative-ui/uiDslValidator";

function validDocument(): UIDslDocument {
  return {
    actions: [],
    audit: {
      createdAt: "2026-07-05T00:00:00.000Z",
      generatedBy: "model",
      model: "red-team",
      traceId: "trace-red-team"
    },
    dataSources: [],
    id: "ui-red-team",
    intentPlanId: "plan-red-team",
    root: {
      component: "StatusBanner",
      id: "status",
      props: {
        text: "安全状态",
        tone: "info"
      }
    },
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}

describe("prompt injection hardening for generated UI", () => {
  test("rejects unknown actions", () => {
    const result = validateUIDslDocument({
      ...validDocument(),
      actions: [
        {
          actionId: "system.delete_everything" as never,
          id: "bad-action",
          input: {},
          label: "删除全部",
          riskLevel: "high"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Unknown registered action")])
    );
  });

  test("rejects function bodies in data source params", () => {
    const result = validateUIDslDocument({
      ...validDocument(),
      dataSources: [
        {
          id: "bad-source",
          params: {
            selector: "() => document.querySelector('#root').remove()"
          },
          sourceId: "runtime.context_view"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Executable values are not allowed")])
    );
  });

  test("rejects direct css and dom injection props", () => {
    const result = validateUIDslDocument({
      ...validDocument(),
      root: {
        component: "Panel",
        id: "bad-panel",
        props: {
          dangerouslySetInnerHTML: "<script>alert(1)</script>",
          style: "position:fixed;inset:0",
          text: "Injected"
        }
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Arbitrary style props are not allowed"),
        expect.stringContaining("Executable props are not allowed")
      ])
    );
  });
});
