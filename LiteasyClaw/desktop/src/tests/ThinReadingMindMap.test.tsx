import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  normalizeMindMapMarkdown,
  ThinReadingMindMap
} from "../app/features/thin-reading/ThinReadingMindMap";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import type { ThinReadingDocument } from "../app/features/thin-reading/thinReading.types";

function createDeepDocument() {
  const fixture = createThinReadingFixture();
  let document = createThinReadingDocument(fixture);
  const nodeIds = [document.rootNodeId];

  ["论文定位", "研究动机", "敏感度定义", "两阶段估计"].forEach((title, index) => {
    document = advanceThinReadingDocument(document, {
      parentNodeId: nodeIds[nodeIds.length - 1],
      seed: {
        ...fixture.rootSeed,
        summary: index === 2
          ? "累计动作敏感度为 `S_l(c)^{(b)}`，用于比较不同层的量化误差。"
          : `${title}的知识原子。`
      },
      source: {
        kind: "omitted_section",
        label: title,
        sectionKey: `mindmap-${index}`
      },
      title: index === 2 ? "累计动作敏感度 `S_l(c)^{(b)}`" : title
    });
    nodeIds.push(document.activeNodeId);
  });

  return { document, nodeIds };
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

describe("ThinReadingMindMap", () => {
  test("normalizes common model-emitted math wrappers for KaTeX", () => {
    expect(normalizeMindMapMarkdown("`S_l(c)^{(b)}`")).toBe("$S_l(c)^{(b)}$");
    expect(normalizeMindMapMarkdown("\\(x_i\\)")).toBe("$x_i$");
  });

  test("uses two horizontal derivations and stacks deeper descendants below their parent", () => {
    const { document, nodeIds } = createDeepDocument();
    const { container } = render(
      <ThinReadingMindMap
        activeNodeId={document.activeNodeId}
        document={document}
        maxVisibleDepth={4}
        onSelectNode={vi.fn()}
      />
    );

    expect(container.querySelector(`[data-mindmap-node-id="${nodeIds[0]}"]`)).toHaveClass("is-horizontal");
    expect(container.querySelector(`[data-mindmap-node-id="${nodeIds[1]}"]`)).toHaveClass("is-horizontal");
    expect(container.querySelector(`[data-mindmap-node-id="${nodeIds[2]}"]`)).toHaveClass("is-vertical");
    expect(container.querySelector(`[data-mindmap-node-id="${nodeIds[3]}"]`)).toHaveClass("is-vertical");
    expect(container.querySelectorAll(".thin-reading__mindmap-node .katex")).not.toHaveLength(0);
  });

  test("copies a dragged subtree into an independently scrollable comparison pane", () => {
    const { document, nodeIds } = createDeepDocument();
    const { container } = render(
      <ThinReadingMindMap
        activeNodeId={document.activeNodeId}
        document={document}
        maxVisibleDepth={4}
        onSelectNode={vi.fn()}
      />
    );
    const draggedNode = container.querySelector<HTMLElement>(
      `[data-mindmap-node-id="${nodeIds[3]}"] > .thin-reading__mindmap-node`
    );
    const dropzone = screen.getByLabelText("拖到此处创建对照分栏");
    const dataTransfer = createDataTransfer();

    expect(draggedNode).not.toBeNull();
    fireEvent.dragStart(draggedNode!, { dataTransfer });
    expect(dropzone).toHaveClass("is-ready");
    fireEvent.dragOver(dropzone, { dataTransfer });
    fireEvent.drop(dropzone, { dataTransfer });

    const primary = screen.getByLabelText("完整思维导图");
    const split = screen.getByLabelText(/对照阅读：累计动作敏感度/);
    expect(within(primary).getByTestId("mindmap-primary-scroll")).toBeInTheDocument();
    expect(within(split).getByTestId("mindmap-split-scroll")).toBeInTheDocument();
    expect(container.querySelectorAll(`[data-mindmap-node-id="${nodeIds[3]}"]`)).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("关闭对照阅读"));
    expect(screen.queryByLabelText(/对照阅读：/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(`[data-mindmap-node-id="${nodeIds[3]}"]`)).toHaveLength(1);
  });
});
