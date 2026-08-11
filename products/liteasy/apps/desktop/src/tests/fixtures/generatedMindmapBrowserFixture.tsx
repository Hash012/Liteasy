import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createRoot } from "react-dom/client";

import { DynamicCanvas } from "../../app/features/generative-ui/DynamicCanvas";
import type { UIDslDocument } from "../../app/features/generative-ui/generativeUi.types";

function createGeneratedMindMapDocument(): UIDslDocument {
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
      traceId: "trace-qvla-mindmap"
    },
    dataSources: [],
    id: "ui-qvla-mindmap",
    intentPlanId: "plan-qvla-mindmap",
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
    },
    surface: "center_artifact",
    version: "liteasy-ui-dsl/v1"
  };
}

export async function mountGeneratedMindMapBrowserFixture(container: HTMLElement | null) {
  if (!container) throw new Error("Generated mind map fixture mount point is missing.");
  document.documentElement.style.overflowX = "hidden";
  document.body.style.margin = "0";
  container.style.minHeight = "100vh";
  createRoot(container).render(
    <FluentProvider theme={webLightTheme}>
      <DynamicCanvas document={createGeneratedMindMapDocument()} onAction={() => undefined} />
    </FluentProvider>
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
