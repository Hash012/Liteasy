import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import {
  AssociationGraphLayer,
  AssociationReadingOverlay,
  type PageGraphAnchorView
} from "../app/features/associations/AssociationGraphLayer";
import type { ThinReadingExternalSource } from "../app/features/thin-reading/thinReading.types";

const anchors: PageGraphAnchorView[] = [
  {
    anchorId: "anchor-1",
    kind: "method",
    label: "self-attention",
    rects: [{ height: 18, left: 180, top: 200, width: 120 }]
  },
  {
    anchorId: "anchor-2",
    kind: "dataset",
    label: "WMT 2014",
    rects: [{ height: 18, left: 420, top: 520, width: 96 }]
  }
];

function source(id: string, overrides: Partial<ThinReadingExternalSource> = {}): ThinReadingExternalSource {
  return {
    abstract: "A traceable abstract for the related work.",
    authors: ["A. Researcher"],
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    id,
    provider: "openalex",
    relation: "topic_search",
    relevance: 0.8,
    retrievalQuery: "self-attention architecture",
    sourceId: id,
    sourceRecordUrl: `https://openalex.org/${id}`,
    title: `Related paper ${id}`,
    url: `https://openalex.org/${id}`,
    year: 2024,
    ...overrides
  };
}

function renderLayer(overrides: Partial<Parameters<typeof AssociationGraphLayer>[0]> = {}) {
  return render(
    <AssociationGraphLayer
      activeSourceId={null}
      anchors={anchors}
      documentHeight={1200}
      focusedAnchorId={null}
      frameWidth={900}
      onClose={vi.fn()}
      onFocusAnchor={vi.fn()}
      onSelectSource={vi.fn()}
      sourcesByAnchor={{
        "anchor-1": [source("W1", { relevance: 0.95 }), source("W2", { relevance: 0.6 })],
        "anchor-2": [source("W3", { relevance: 0.9 })]
      }}
      {...overrides}
    />
  );
}

test("keeps every visible anchor in its own place in the text and draws its related work around it", () => {
  const { container } = renderLayer();

  const chips = Array.from(container.querySelectorAll<HTMLElement>(".association-anchor__chip"));
  expect(chips.map((chip) => chip.textContent)).toEqual(["self-attention", "WMT 2014"]);
  // The chip sits at the anchor's measured rectangle, not at a centre the layer invented.
  expect(chips[0]!.style.left).toBe("180px");
  expect(chips[0]!.style.top).toBe("209px");
  expect(container.querySelectorAll(".association-node")).toHaveLength(3);
  expect(container.querySelectorAll(".association-edge")).toHaveLength(3);
});

test("places the more relevant paper nearer its anchor", () => {
  const { container } = renderLayer();

  const nodes = Array.from(container.querySelectorAll<HTMLElement>(".association-node"));
  const distance = (label: string) => {
    const node = nodes.find((candidate) => candidate.getAttribute("aria-label")?.includes(label))!;
    return Math.hypot(
      Number.parseFloat(node.style.getPropertyValue("--node-left")) - 240,
      Number.parseFloat(node.style.getPropertyValue("--node-top")) - 209
    );
  };

  expect(distance("Related paper W1")).toBeLessThan(distance("Related paper W2"));
});

test("shows a paper shared by two anchors once, with an edge to each", () => {
  const shared = { canonicalPaperId: "openalex:W99", relevance: 0.9 };
  const { container } = renderLayer({
    sourcesByAnchor: {
      "anchor-1": [source("W1a", shared)],
      "anchor-2": [source("W1b", shared)]
    }
  });

  expect(container.querySelectorAll(".association-node")).toHaveLength(1);
  expect(container.querySelectorAll(".association-node.is-crossing")).toHaveLength(1);
  expect(container.querySelectorAll(".association-edge.is-crossing")).toHaveLength(2);
  expect(screen.getByText("2 个锚点交叉")).toBeVisible();
});

test("focusing one anchor dims the other anchor and its papers without unmounting them", () => {
  const onFocusAnchor = vi.fn();
  const { container, rerender } = renderLayer({ onFocusAnchor });

  fireEvent.click(screen.getByRole("button", { name: /锚点：self-attention/u }));
  expect(onFocusAnchor).toHaveBeenCalledWith("anchor-1");

  rerender(
    <AssociationGraphLayer
      activeSourceId={null}
      anchors={anchors}
      documentHeight={1200}
      focusedAnchorId="anchor-1"
      frameWidth={900}
      onClose={vi.fn()}
      onFocusAnchor={onFocusAnchor}
      onSelectSource={vi.fn()}
      sourcesByAnchor={{
        "anchor-1": [source("W1", { relevance: 0.95 })],
        "anchor-2": [source("W3", { relevance: 0.9 })]
      }}
    />
  );

  expect(container.querySelectorAll(".association-anchor.is-dimmed")).toHaveLength(1);
  expect(container.querySelectorAll(".association-node.is-dimmed")).toHaveLength(1);
  expect(container.querySelectorAll(".association-node")).toHaveLength(2);
});

test("hovering a node says why the link exists instead of leaving it to a tooltip", () => {
  const { container } = renderLayer();

  const node = container.querySelector<HTMLElement>(".association-node")!;
  expect(node.getAttribute("title")).toBeNull();
  fireEvent.mouseEnter(node);
  expect(screen.getByText("语义检索")).toBeVisible();
  expect(screen.getAllByText("语义相似，无引用关系").length).toBeGreaterThan(0);
});

test("moves the selected non-OA paper into the reading card without a fake full-text action", () => {
  const selected = source("W9");
  const onAddToLibrary = vi.fn();
  const onSelectSource = vi.fn();
  const { container } = render(
    <AssociationReadingOverlay
      activeSource={selected}
      anchorCount={2}
      onAddToLibrary={onAddToLibrary}
      onClose={vi.fn()}
      onOpenFullText={vi.fn()}
      onSelectSource={onSelectSource}
      sourceCount={3}
    />
  );

  expect(container.querySelector(".association-reading-card")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "阅读全文" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
  expect(onAddToLibrary).toHaveBeenCalledWith(selected);
  expect(screen.getByRole("link", { name: /查看来源记录/u })).toHaveAttribute("href", selected.url);
  fireEvent.click(screen.getByRole("button", { name: "返回关联图" }));
  expect(onSelectSource).toHaveBeenCalledWith("");
});

test("keeps provider degradation visible rather than showing an empty graph", () => {
  render(
    <AssociationReadingOverlay
      activeSource={null}
      anchorCount={2}
      onAddToLibrary={vi.fn()}
      onClose={vi.fn()}
      onOpenFullText={vi.fn()}
      onSelectSource={vi.fn()}
      sourceCount={1}
      warning="OpenAlex 客户端直连失败；已降级为其他公开来源。"
    />
  );

  expect(screen.getByRole("status")).toHaveTextContent("OpenAlex 客户端直连失败");
});

test("says why a page is empty instead of showing a blank layer", () => {
  const { rerender } = render(
    <AssociationReadingOverlay
      activeSource={null}
      anchorCount={0}
      onAddToLibrary={vi.fn()}
      onClose={vi.fn()}
      onOpenFullText={vi.fn()}
      onSelectSource={vi.fn()}
      sourceCount={0}
    />
  );
  expect(screen.getByRole("note")).toHaveTextContent("当前页没有识别出锚点");

  rerender(
    <AssociationReadingOverlay
      activeSource={null}
      anchorCount={3}
      onAddToLibrary={vi.fn()}
      onClose={vi.fn()}
      onOpenFullText={vi.fn()}
      onSelectSource={vi.fn()}
      sourceCount={0}
    />
  );
  expect(screen.getByRole("note")).toHaveTextContent("还没有可验证的关联文献");
});
