import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DynamicCanvas } from "../app/features/generative-ui/DynamicCanvas";
import type { UIDslDocument } from "../app/features/generative-ui/generativeUi.types";

function createActionDocument(): UIDslDocument {
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
      traceId: "trace-canvas"
    },
    dataSources: [],
    id: "ui-canvas",
    intentPlanId: "plan-canvas",
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

test("renders fallback for invalid DSL", () => {
  render(
    <DynamicCanvas
      document={{
        ...createActionDocument(),
        root: {
          component: "MagicPanel",
          id: "bad",
          props: {}
        } as UIDslDocument["root"]
      }}
      onAction={vi.fn()}
    />
  );

  expect(screen.getByText("动态界面暂时不可用")).toBeInTheDocument();
});

test("routes ActionBar clicks as action refs", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  const document = createActionDocument();

  render(<DynamicCanvas document={document} onAction={onAction} />);

  expect(screen.getByLabelText("动态界面：已应用卡通风格。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "恢复默认" }));

  expect(onAction).toHaveBeenCalledWith(document.actions[0]);
});

test("renders fallback when DSL fails UX validation", () => {
  const document = createActionDocument();

  render(
    <DynamicCanvas
      document={{
        ...document,
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
        ],
        root: {
          component: "ActionBar",
          id: "danger-actions",
          props: {
            actionIds: ["delete"],
            primaryActionId: "delete"
          }
        }
      }}
      onAction={vi.fn()}
    />
  );

  expect(screen.getByLabelText("动态界面降级")).toBeInTheDocument();
});
