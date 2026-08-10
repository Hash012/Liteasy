import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import {
  AssociationGraphLayer,
  AssociationReadingOverlay,
  type PageGraphAnchorView
} from "../app/features/associations/AssociationGraphLayer";
import { externalPdfDragMimeType } from "../app/features/library/externalPdfDownload";
import type {
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../app/features/thin-reading/thinReading.types";

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
  expect(container.querySelectorAll(".association-edge.is-primary.is-ink")).toHaveLength(3);
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

test("shows a shared paper once with only its stable primary edge at rest", () => {
  const shared = { canonicalPaperId: "openalex:W99", relevance: 0.9 };
  const { container } = renderLayer({
    sourcesByAnchor: {
      "anchor-1": [source("W1a", shared)],
      "anchor-2": [source("W1b", shared)]
    }
  });

  expect(container.querySelectorAll(".association-node")).toHaveLength(1);
  expect(container.querySelectorAll(".association-node.is-crossing")).toHaveLength(1);
  expect(container.querySelectorAll(".association-edge.is-primary.is-ink")).toHaveLength(1);
  expect(container.querySelectorAll(".association-edge.is-secondary.is-ink")).toHaveLength(0);
  expect(screen.getByText("2 个锚点交叉")).toBeVisible();
});

test("keeps a low-relevance shared paper expanded with its crossing badge at mobile width", () => {
  const shared = { canonicalPaperId: "openalex:W99", relevance: 0.1 };
  const { container } = renderLayer({
    frameWidth: 390,
    sourcesByAnchor: {
      "anchor-1": [source("W1a", shared)],
      "anchor-2": [source("W1b", shared)]
    }
  });

  const node = container.querySelector(".association-node.is-crossing");
  expect(node).not.toHaveClass("is-dot");
  expect(node?.querySelector(".association-node__crossing")).toBeVisible();
});

test("adds secondary anchor edges only while the shared paper or secondary anchor is focused", () => {
  const shared = { canonicalPaperId: "openalex:W99", relevance: 0.9 };
  const sourcesByAnchor = {
    "anchor-1": [source("W1a", { ...shared, confidenceBasis: "author_citation" })],
    "anchor-2": [source("W1b", shared)]
  };
  const { container, rerender } = renderLayer({ sourcesByAnchor });
  const positionsBefore = container.querySelector<HTMLElement>(".association-node")?.getAttribute("style");

  rerender(
    <AssociationGraphLayer
      activeSourceId={null}
      anchors={anchors}
      documentHeight={1200}
      focusedAnchorId="anchor-2"
      frameWidth={900}
      onClose={vi.fn()}
      onFocusAnchor={vi.fn()}
      onSelectSource={vi.fn()}
      sourcesByAnchor={sourcesByAnchor}
    />
  );

  const secondary = container.querySelector(".association-edge.is-secondary.is-hit");
  expect(secondary).toHaveAttribute("role", "img");
  expect(secondary).toHaveAccessibleName(/次级关联.*W99.*WMT 2014/u);
  expect(container.querySelector<HTMLElement>(".association-node")?.getAttribute("style")).toBe(positionsBefore);
});

test("shows secondary memberships when a shared paper is focused without moving it", () => {
  const shared = { canonicalPaperId: "openalex:W99", relevance: 0.9 };
  const { container } = renderLayer({
    sourcesByAnchor: {
      "anchor-1": [source("W1a", { ...shared, confidenceBasis: "author_citation" })],
      "anchor-2": [source("W1b", shared)]
    }
  });
  const node = container.querySelector<HTMLElement>(".association-node")!;
  const positionBefore = node.getAttribute("style");

  fireEvent.mouseEnter(node);

  expect(container.querySelectorAll(".association-edge.is-secondary.is-ink")).toHaveLength(1);
  expect(node.getAttribute("style")).toBe(positionBefore);
});

test("keeps merged component identity out of the representative source provenance", () => {
  const onSelectSource = vi.fn();
  const setData = vi.fn();
  const canonical = source("openalex-record", {
    canonicalPaperId: "openalex:W42",
    doi: "10.1000/shared",
    provider: "openalex",
    sourceId: "W42"
  });
  const representative = source("crossref-record", {
    canonicalPaperId: undefined,
    confidenceBasis: "author_citation",
    doi: "10.1000/shared",
    provider: "crossref",
    sourceId: "10.1000/shared",
    sourceRecordUrl: "https://api.crossref.org/works/10.1000/shared",
    url: "https://doi.org/10.1000/shared"
  });
  const { container } = renderLayer({
    focusedAnchorId: "anchor-1",
    onSelectSource,
    sourcesByAnchor: {
      "anchor-1": [canonical],
      "anchor-2": [representative]
    }
  });
  const node = container.querySelector<HTMLElement>(".association-node")!;

  expect(container.querySelector(".association-edge.is-secondary.is-hit"))
    .toHaveAccessibleName(/openalex:W42/u);
  fireEvent.click(node);
  expect(onSelectSource).toHaveBeenCalledWith("crossref-record");
  fireEvent.dragStart(node, { dataTransfer: { effectAllowed: "", setData } });

  expect(setData).toHaveBeenCalledWith(externalPdfDragMimeType, expect.any(String));
  const payload = JSON.parse(setData.mock.calls[0]![1] as string);
  expect(payload).toMatchObject({
    doi: "10.1000/shared",
    id: "crossref-record",
    provider: "crossref",
    sourceId: "10.1000/shared",
    sourceRecordUrl: "https://api.crossref.org/works/10.1000/shared"
  });
  expect(payload).not.toHaveProperty("canonicalPaperId");
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

test("renders page-wide paper relations beneath anchor ink with an exact final hit layer", () => {
  const paperEdges: ThinReadingRecommendationPaperEdge[] = [{
    directed: true,
    evidenceRecordUrls: ["https://api.openalex.org/works/W1"],
    kind: "direct_citation",
    provider: "openalex",
    sourcePaperId: "openalex:W1",
    strength: 0.88,
    targetPaperId: "openalex:W3"
  }];
  const { container } = renderLayer({ paperEdges });
  const edgeSvg = container.querySelector(".association-layer__edges")!;
  const layers = Array.from(edgeSvg.querySelectorAll("[data-edge-layer]"))
    .map((path) => path.getAttribute("data-edge-layer"));

  expect(layers.slice(0, 2)).toEqual(["paper-wash", "paper-ink"]);
  expect(layers.indexOf("paper-ink")).toBeLessThan(layers.indexOf("primary-wash"));
  expect(layers.lastIndexOf("edge-hit")).toBe(layers.length - 1);
  expect(container.querySelector(".association-edge.is-paper-relation.is-direct-citation.is-ink"))
    .toHaveAttribute("marker-end", "url(#association-direct-citation-end)");
  expect(screen.getByRole("img", { name: /直接引用.*Related paper W1.*Related paper W3/u }))
    .toBeInTheDocument();
});

test("exposes one keyboard-reachable logical primary edge and focuses all its visual strokes", () => {
  const onClose = vi.fn();
  const { container } = renderLayer({
    onClose,
    sourcesByAnchor: {
      "anchor-1": [source("W1", { confidenceBasis: "author_citation" })],
      "anchor-2": []
    }
  });

  const logicalEdge = screen.getByRole("img", {
    name: /self-attention.*Related paper W1.*作者亲引/u
  });
  expect(logicalEdge).toHaveClass("is-primary", "is-hit");
  expect(logicalEdge).toHaveAttribute("tabindex", "0");
  expect(container.querySelectorAll(".association-edge.is-primary:not(.is-hit)")).toHaveLength(3);
  for (const visualStroke of container.querySelectorAll(".association-edge.is-primary:not(.is-hit)")) {
    expect(visualStroke).toHaveAttribute("aria-hidden", "true");
  }

  fireEvent.focus(logicalEdge);
  expect(container.querySelectorAll(".association-edge.is-primary.is-active")).toHaveLength(4);
  fireEvent.blur(logicalEdge);
  expect(container.querySelectorAll(".association-edge.is-primary.is-active")).toHaveLength(0);
  fireEvent.mouseEnter(logicalEdge);
  expect(container.querySelectorAll(".association-edge.is-primary.is-active")).toHaveLength(4);
  fireEvent.mouseLeave(logicalEdge);

  fireEvent.click(container.querySelector(".association-layer__scrim")!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("restores keyboard focus emphasis after a different edge stops being hovered", () => {
  renderLayer({
    sourcesByAnchor: {
      "anchor-1": [source("W1"), source("W2")],
      "anchor-2": []
    }
  });
  const first = screen.getByRole("img", { name: /self-attention.*Related paper W1/u });
  const second = screen.getByRole("img", { name: /self-attention.*Related paper W2/u });

  fireEvent.focus(first);
  fireEvent.mouseEnter(second);
  expect(second).toHaveClass("is-active");
  expect(first).not.toHaveClass("is-active");
  fireEvent.mouseLeave(second);
  expect(first).toHaveClass("is-active");

  fireEvent.mouseLeave(first);
  expect(first).toHaveClass("is-active");
  fireEvent.blur(first);
  expect(first).not.toHaveClass("is-active");
});

test("does not restore stale edge focus after a relation is removed and added again", () => {
  const sourcesByAnchor = {
    "anchor-1": [source("W1")],
    "anchor-2": []
  };
  const props = {
    activeSourceId: null,
    anchors,
    documentHeight: 1200,
    focusedAnchorId: null,
    frameWidth: 900,
    onClose: vi.fn(),
    onFocusAnchor: vi.fn(),
    onSelectSource: vi.fn()
  };
  const { container, rerender } = render(
    <AssociationGraphLayer {...props} sourcesByAnchor={sourcesByAnchor} />
  );
  const edge = screen.getByRole("img", { name: /self-attention.*Related paper W1/u });
  fireEvent.focus(edge);
  fireEvent.mouseEnter(edge);

  rerender(<AssociationGraphLayer {...props} sourcesByAnchor={{ "anchor-1": [], "anchor-2": [] }} />);
  expect(container.querySelectorAll(".association-edge.is-hit")).toHaveLength(0);
  rerender(<AssociationGraphLayer {...props} sourcesByAnchor={sourcesByAnchor} />);

  expect(screen.getByRole("img", { name: /self-attention.*Related paper W1/u }))
    .not.toHaveClass("is-active");
});

test("uses one roving edge tab stop and arrow navigation across every relation layer", () => {
  const shared = { canonicalPaperId: "openalex:W99", relevance: 0.9 };
  const { container } = renderLayer({
    focusedAnchorId: "anchor-2",
    paperEdges: [{
      directed: false,
      evidenceRecordUrls: ["https://api.openalex.org/works/W99"],
      kind: "co_cited",
      provider: "openalex",
      sourcePaperId: "openalex:W99",
      strength: 0.8,
      targetPaperId: "openalex:W2"
    }],
    sourcesByAnchor: {
      "anchor-1": [source("W1a", shared), source("W2")],
      "anchor-2": [source("W1b", shared)]
    }
  });
  const logicalEdges = Array.from(
    container.querySelectorAll<SVGPathElement>('[role="img"].association-edge.is-hit')
  );

  expect(logicalEdges.some((edge) => edge.classList.contains("is-paper-relation"))).toBe(true);
  expect(logicalEdges.some((edge) => edge.classList.contains("is-primary"))).toBe(true);
  expect(logicalEdges.some((edge) => edge.classList.contains("is-secondary"))).toBe(true);
  expect(logicalEdges.filter((edge) => edge.tabIndex === 0)).toHaveLength(1);
  expect(logicalEdges.filter((edge) => edge.tabIndex === -1)).toHaveLength(logicalEdges.length - 1);
  expect(container.querySelector(".association-node")).not.toHaveAttribute("tabindex", "-1");

  act(() => logicalEdges[0]!.focus());
  fireEvent.keyDown(logicalEdges[0]!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(logicalEdges[1]);
  expect(logicalEdges[1]).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(logicalEdges[1]!, { key: "End" });
  expect(document.activeElement).toBe(logicalEdges.at(-1));
  fireEvent.keyDown(logicalEdges.at(-1)!, { key: "Home" });
  expect(document.activeElement).toBe(logicalEdges[0]);
  fireEvent.keyDown(logicalEdges[0]!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(logicalEdges.at(-1));
});

test("represents every rendered relation by its hit path instead of an auxiliary ink stroke", () => {
  const { container } = renderLayer({
    paperEdges: [{
      directed: false,
      evidenceRecordUrls: ["https://api.openalex.org/works/W1"],
      kind: "co_cited",
      provider: "openalex",
      sourcePaperId: "openalex:W1",
      strength: 0.7,
      targetPaperId: "openalex:W3"
    }],
    sourcesByAnchor: {
      "anchor-1": [source("W1")],
      "anchor-2": [source("W3")]
    }
  });
  const logicalEdges = Array.from(container.querySelectorAll('[role="img"].association-edge'));

  expect(logicalEdges).toHaveLength(3);
  expect(logicalEdges.every((edge) => edge.classList.contains("is-hit"))).toBe(true);
  expect(container.querySelectorAll(".association-edge.is-ink[role]")).toHaveLength(0);
});

test("maps canonical registry papers to the same graphite semantic presentation as their edge", () => {
  const { container } = renderLayer({
    sourcesByAnchor: {
      "anchor-1": [source("W1", { confidenceBasis: "canonical_registry" })],
      "anchor-2": []
    }
  });

  expect(container.querySelector(".association-node[data-basis='canonical_registry']"))
    .toHaveClass("is-semantic-retrieval");
  expect(container.querySelector(".association-edge.is-primary.is-ink"))
    .toHaveClass("is-semantic-retrieval");
  expect(screen.getByLabelText("当前关系图例")).toHaveTextContent("权威词表精确匹配");
});

test("shows only relation kinds present in the current projection", () => {
  const { rerender } = renderLayer({
    sourcesByAnchor: {
      "anchor-1": [source("W1", { confidenceBasis: "author_citation" })],
      "anchor-2": []
    }
  });

  expect(screen.getByLabelText("当前关系图例")).toHaveTextContent("作者亲引");
  expect(screen.getByLabelText("当前关系图例")).not.toHaveTextContent("引用图推导");
  expect(screen.getByLabelText("当前关系图例")).not.toHaveTextContent("直接引用");

  rerender(
    <AssociationGraphLayer
      activeSourceId={null}
      anchors={anchors}
      documentHeight={1200}
      focusedAnchorId={null}
      frameWidth={900}
      onClose={vi.fn()}
      onFocusAnchor={vi.fn()}
      onSelectSource={vi.fn()}
      paperEdges={[{
        directed: false,
        evidenceRecordUrls: ["https://api.openalex.org/works/W1"],
        kind: "co_cited",
        provider: "openalex",
        sourcePaperId: "openalex:W1",
        strength: 0.7,
        targetPaperId: "openalex:W3"
      }]}
      sourcesByAnchor={{
        "anchor-1": [source("W1", { confidenceBasis: "citation_graph" })],
        "anchor-2": [source("W3", { confidenceBasis: "citation_graph" })]
      }}
    />
  );

  expect(screen.getByLabelText("当前关系图例")).toHaveTextContent("引用图推导");
  expect(screen.getByLabelText("当前关系图例")).toHaveTextContent("共同被引");
  expect(screen.getByLabelText("当前关系图例")).not.toHaveTextContent("作者亲引");
  expect(screen.getByLabelText("当前关系图例")).not.toHaveTextContent("共享参考文献");
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
