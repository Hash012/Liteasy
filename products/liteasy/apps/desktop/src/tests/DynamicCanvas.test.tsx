import { fireEvent, render, screen, within } from "@testing-library/react";
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

function createMindMapDocument(): UIDslDocument {
  return {
    ...createActionDocument(),
    id: "ui-qvla-mindmap",
    surface: "center_artifact",
    root: {
      children: [{
        component: "ActionBar",
        id: "mindmap-actions",
        props: { actionIds: ["reset-theme"] }
      }],
      component: "MindMap",
      id: "artifact-mindmap",
      props: {
        nodes: [
          { evidenceIds: ["evidence-root"], id: "qvla-root", kind: "root", label: "QVLA 论文思维导图" },
          { id: "qvla-section", kind: "section", label: "动作空间敏感度分析", parentId: "qvla-root" },
          { id: "qvla-formula", kind: "term", label: "累计动作敏感度 `S_(l,c)^(b)`", parentId: "qvla-section" },
          { id: "qvla-definition", kind: "term", label: "定义：量化动作与参考动作偏差的期望", parentId: "qvla-formula" }
        ],
        title: "Literature Mind Map"
      }
    }
  };
}

function createDataTransfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value)
  } as unknown as DataTransfer;
}

test("renders generated mind maps with hybrid columns, KaTeX, and a copied split pane", () => {
  const { container } = render(<DynamicCanvas document={createMindMapDocument()} onAction={vi.fn()} />);

  expect(container.querySelector('[data-generated-mindmap-depth="0"]')).toHaveClass("is-horizontal");
  expect(container.querySelector('[data-generated-mindmap-depth="1"]')).toHaveClass("is-horizontal");
  expect(container.querySelector('[data-generated-mindmap-depth="2"]')).toHaveClass("is-vertical");
  expect(container.querySelector('[data-generated-mindmap-node-id="qvla-formula"] .katex')).toBeInTheDocument();

  const formulaNode = container.querySelector<HTMLElement>(
    '[data-generated-mindmap-node-id="qvla-formula"] > .genui-mindmap-node'
  );
  const dropzone = screen.getByLabelText("拖到此处创建生成思维导图对照分栏");
  const dataTransfer = createDataTransfer();
  fireEvent.dragStart(formulaNode!, { dataTransfer });
  fireEvent.dragOver(dropzone, { dataTransfer });
  fireEvent.drop(dropzone, { dataTransfer });

  const primary = screen.getByLabelText("完整生成思维导图");
  const split = screen.getByLabelText(/生成思维导图对照阅读：累计动作敏感度/);
  expect(within(primary).getByTestId("generated-mindmap-primary-scroll")).toBeInTheDocument();
  expect(within(split).getByTestId("generated-mindmap-split-scroll")).toBeInTheDocument();
  expect(container.querySelectorAll('[data-generated-mindmap-node-id="qvla-formula"]')).toHaveLength(2);
});
