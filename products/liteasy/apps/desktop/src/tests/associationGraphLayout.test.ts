import { expect, test } from "vitest";

import {
  evaluateAssociationLayout,
  layoutAssociationPageGraph,
  layoutConstrainedAssociationPageGraph,
  maximumPageGraphSources,
  pageGraphDotSize,
  pageGraphNodeHeight,
  pageGraphNodeWidth,
  type PageGraphInput
} from "../app/features/associations/associationGraphLayout";
import type { ThinReadingExternalSource } from "../app/features/thin-reading/thinReading.types";

function source(
  id: string,
  relevance: number,
  overrides: Partial<ThinReadingExternalSource> = {}
): ThinReadingExternalSource {
  return {
    abstract: "",
    authors: [],
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    id,
    provider: "openalex",
    relation: "topic_search",
    relevance,
    retrievalQuery: "self-attention",
    sourceId: id,
    sourceRecordUrl: `https://openalex.org/${id}`,
    title: id,
    url: `https://openalex.org/${id}`,
    ...overrides
  };
}

function input(overrides: Partial<PageGraphInput> = {}): PageGraphInput {
  return {
    anchors: [{ anchorId: "a1", rect: { height: 16, left: 300, top: 400, width: 120 } }],
    documentHeight: 2400,
    frameWidth: 900,
    sourcesByAnchor: {},
    ...overrides
  };
}

const distanceToAnchor = (node: { left: number; top: number }, left = 360, top = 408) =>
  Math.hypot(node.left - left, node.top - top);

test("places the more relevant paper nearer its anchor and leaves confidence out of distance", () => {
  const graph = layoutAssociationPageGraph(input({
    sourcesByAnchor: {
      a1: [source("W1", 0.95, { confidence: 0.3 }), source("W2", 0.4, { confidence: 1 })]
    }
  }));

  const near = graph.nodes.find((node) => node.paperKey === "W1")!;
  const far = graph.nodes.find((node) => node.paperKey === "W2")!;
  expect(distanceToAnchor(near)).toBeLessThan(distanceToAnchor(far));
  expect(near.confidence).toBe(0.3);
  expect(far.confidence).toBe(1);
});

test("caps one anchor's fan and reports what it left out instead of dropping it silently", () => {
  const graph = layoutAssociationPageGraph(input({
    sourcesByAnchor: {
      a1: Array.from({ length: 11 }, (_, index) => source(`W${index}`, 1 - index / 20))
    }
  }));

  expect(graph.nodes).toHaveLength(maximumPageGraphSources);
  expect(graph.hiddenCountByAnchor.a1).toBe(11 - maximumPageGraphSources);
});

test("merges a paper shared by two anchors into one node with one edge per anchor", () => {
  const shared = { canonicalPaperId: "openalex:W42", confidence: 0.6 };
  const graph = layoutAssociationPageGraph(input({
    anchors: [
      { anchorId: "a1", rect: { height: 16, left: 200, top: 300, width: 90 } },
      { anchorId: "a2", rect: { height: 16, left: 500, top: 900, width: 90 } }
    ],
    sourcesByAnchor: {
      a1: [source("W42a", 0.9, shared), source("W7", 0.8)],
      a2: [source("W42b", 0.85, shared)]
    }
  }));

  const crossing = graph.nodes.filter((node) => node.anchorIds.length > 1);
  expect(crossing).toHaveLength(1);
  expect(crossing[0]!.paperKey).toBe("openalex:W42");
  expect([...crossing[0]!.anchorIds].sort()).toEqual(["a1", "a2"]);
  // A crossing is never collapsed to a dot: it is the one thing this view can show that a
  // per-anchor nebula cannot.
  expect(crossing[0]!.isDot).toBe(false);
  expect(graph.edges.filter((edge) => edge.paperKey === "openalex:W42").map((edge) => edge.anchorId).sort())
    .toEqual(["a1", "a2"]);
  expect(graph.edges.every((edge) => edge.crossing === (edge.paperKey === "openalex:W42"))).toBe(true);
});

test("keeps every node inside the frame and clear of the others", () => {
  const graph = layoutAssociationPageGraph(input({
    anchors: [
      { anchorId: "a1", rect: { height: 16, left: 180, top: 260, width: 120 } },
      { anchorId: "a2", rect: { height: 16, left: 620, top: 420, width: 120 } },
      { anchorId: "a3", rect: { height: 16, left: 320, top: 700, width: 120 } }
    ],
    sourcesByAnchor: {
      a1: Array.from({ length: 6 }, (_, index) => source(`A${index}`, 1 - index / 12)),
      a2: Array.from({ length: 6 }, (_, index) => source(`B${index}`, 1 - index / 12)),
      a3: Array.from({ length: 6 }, (_, index) => source(`C${index}`, 1 - index / 12))
    }
  }));

  for (const node of graph.nodes) {
    expect(node.left).toBeGreaterThanOrEqual(pageGraphNodeWidth / 2);
    expect(node.left).toBeLessThanOrEqual(900 - pageGraphNodeWidth / 2);
    expect(node.top).toBeGreaterThan(0);
  }

  for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
      const left = graph.nodes[leftIndex]!;
      const right = graph.nodes[rightIndex]!;
      const half = (node: typeof left) => ({
        horizontal: node.isDot ? pageGraphDotSize / 2 : pageGraphNodeWidth / 2,
        vertical: node.isDot ? pageGraphDotSize / 2 : pageGraphNodeHeight / 2
      });
      const apart =
        Math.abs(left.left - right.left) >= half(left).horizontal + half(right).horizontal ||
        Math.abs(left.top - right.top) >= half(left).vertical + half(right).vertical;
      expect(apart).toBe(true);
    }
  }
});

test("never parks a node on an anchor or its label", () => {
  const anchor = { anchorId: "a1", labelWidth: 180, rect: { height: 18, left: 300, top: 400, width: 140 } };
  const graph = layoutAssociationPageGraph(input({
    anchors: [anchor],
    sourcesByAnchor: {
      a1: Array.from({ length: 8 }, (_, index) => source(`W${index}`, 1 - index / 10))
    }
  }));

  const chip = {
    bottom: anchor.rect.top + anchor.rect.height / 2 + 15,
    left: anchor.rect.left - 6,
    right: anchor.rect.left - 6 + anchor.labelWidth,
    top: anchor.rect.top + anchor.rect.height / 2 - 15
  };
  for (const node of graph.nodes) {
    const half = node.isDot
      ? { horizontal: pageGraphDotSize / 2, vertical: pageGraphDotSize / 2 }
      : { horizontal: pageGraphNodeWidth / 2, vertical: pageGraphNodeHeight / 2 };
    const clear = node.left + half.horizontal <= chip.left ||
      node.left - half.horizontal >= chip.right ||
      node.top + half.vertical <= chip.top ||
      node.top - half.vertical >= chip.bottom;
    expect(clear).toBe(true);
  }
});

test("is deterministic for identical input", () => {
  const build = () => layoutAssociationPageGraph(input({
    anchors: [
      { anchorId: "a1", rect: { height: 16, left: 180, top: 260, width: 120 } },
      { anchorId: "a2", rect: { height: 16, left: 620, top: 420, width: 120 } }
    ],
    sourcesByAnchor: {
      a1: Array.from({ length: 8 }, (_, index) => source(`A${index}`, 1 - index / 12)),
      a2: Array.from({ length: 8 }, (_, index) => source(`B${index}`, 1 - index / 12))
    }
  }));

  expect(build()).toEqual(build());
});

test("keeps a dense primary fan in one side sector with zero primary crossings", () => {
  const graph = layoutConstrainedAssociationPageGraph(input({
    anchors: [{ anchorId: "a1", rect: { height: 18, left: 500, top: 430, width: 120 } }],
    documentHeight: 1000,
    frameWidth: 1200,
    sourcesByAnchor: {
      a1: Array.from({ length: 8 }, (_, index) => source(`dense-${index}`, 1 - index / 12))
    }
  }));

  expect(graph.layoutSource).toBe("constrained");
  expect(graph.quality.sameSideViolations).toBe(0);
  expect(graph.quality.primaryEdgeCrossings).toBe(0);
  expect(graph.quality.nodeOverlaps).toBe(0);
  expect(
    graph.nodes.every((node) => node.left < 560) ||
    graph.nodes.every((node) => node.left > 560)
  ).toBe(true);
});

test("assigns adjacent dense anchors deterministically without crossing primary fans", () => {
  const graph = layoutConstrainedAssociationPageGraph(input({
    anchors: [
      { anchorId: "a1", rect: { height: 18, left: 500, top: 280, width: 120 } },
      { anchorId: "a2", rect: { height: 18, left: 500, top: 680, width: 120 } }
    ],
    documentHeight: 1100,
    frameWidth: 1200,
    sourcesByAnchor: {
      a1: Array.from({ length: 6 }, (_, index) => source(`upper-${index}`, 1 - index / 10)),
      a2: Array.from({ length: 6 }, (_, index) => source(`lower-${index}`, 1 - index / 10))
    }
  }));

  expect(graph.layoutSource).toBe("constrained");
  expect(graph.quality).toMatchObject({
    anchorObstructions: 0,
    nodeOverlaps: 0,
    overflowCount: 0,
    primaryEdgeCrossings: 0,
    sameSideViolations: 0
  });
  for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
    const left = graph.nodes[leftIndex]!;
    const leftHalfWidth = left.isDot ? pageGraphDotSize / 2 : pageGraphNodeWidth / 2;
    const leftHalfHeight = left.isDot ? pageGraphDotSize / 2 : pageGraphNodeHeight / 2;
    if (!left.isDot) {
      expect(left.left - leftHalfWidth).toBeGreaterThanOrEqual(10);
      expect(1200 - left.left - leftHalfWidth).toBeGreaterThanOrEqual(10);
      expect(left.top - leftHalfHeight).toBeGreaterThanOrEqual(8);
      expect(1100 - left.top - leftHalfHeight).toBeGreaterThanOrEqual(8);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
      const right = graph.nodes[rightIndex]!;
      const rightHalfWidth = right.isDot ? pageGraphDotSize / 2 : pageGraphNodeWidth / 2;
      const rightHalfHeight = right.isDot ? pageGraphDotSize / 2 : pageGraphNodeHeight / 2;
      const horizontalGap = Math.abs(left.left - right.left) - leftHalfWidth - rightHalfWidth;
      const verticalGap = Math.abs(left.top - right.top) - leftHalfHeight - rightHalfHeight;
      expect(horizontalGap >= 10 || verticalGap >= 10).toBe(true);
    }
  }
});

test("uses all page-wide paper relations as springs across primary owner groups", () => {
  const relationInput = input({
    anchors: [
      { anchorId: "a1", rect: { height: 16, left: 180, top: 350, width: 100 } },
      { anchorId: "a2", rect: { height: 16, left: 820, top: 650, width: 100 } }
    ],
    documentHeight: 1100,
    frameWidth: 1200,
    paperEdges: [{
      directed: false,
      kind: "co_cited",
      sourcePaperKey: "A",
      strength: 1,
      targetPaperKey: "B"
    }],
    sourcesByAnchor: {
      a1: [source("A", 0.9)],
      a2: [source("B", 0.9)]
    }
  });
  const graph = layoutConstrainedAssociationPageGraph(relationInput);
  const withoutRelation = layoutConstrainedAssociationPageGraph({ ...relationInput, paperEdges: [] });
  const paperDistance = (result: typeof graph) => Math.hypot(
    result.nodes[0]!.left - result.nodes[1]!.left,
    result.nodes[0]!.top - result.nodes[1]!.top
  );

  expect(graph.layoutSource).toBe("constrained");
  expect(graph.paperEdges).toHaveLength(1);
  expect(graph.paperEdges[0]).toMatchObject({ sourcePaperKey: "A", targetPaperKey: "B" });
  expect(paperDistance(graph)).toBeLessThan(paperDistance(withoutRelation));
  expect(graph.quality.weightedStress).toBeLessThanOrEqual(
    evaluateAssociationLayout(relationInput, layoutAssociationPageGraph(relationInput)).weightedStress
  );
});

test("is deterministic for identical constrained input", () => {
  const constrainedInput = input({
    anchors: [
      { anchorId: "a1", rect: { height: 16, left: 250, top: 300, width: 100 } },
      { anchorId: "a2", rect: { height: 16, left: 250, top: 700, width: 100 } }
    ],
    documentHeight: 1200,
    frameWidth: 1000,
    sourcesByAnchor: {
      a1: Array.from({ length: 4 }, (_, index) => source(`A${index}`, 0.9 - index / 10)),
      a2: Array.from({ length: 4 }, (_, index) => source(`B${index}`, 0.9 - index / 10))
    }
  });

  expect(layoutConstrainedAssociationPageGraph(constrainedInput))
    .toEqual(layoutConstrainedAssociationPageGraph(constrainedInput));
});

test("returns exact baseline positions when no candidate can satisfy hard constraints", () => {
  const impossible = input({
    anchors: [{ anchorId: "a1", rect: { height: 18, left: 70, top: 60, width: 80 } }],
    documentHeight: 110,
    frameWidth: 140,
    sourcesByAnchor: {
      a1: [source("too-large", 0.9)]
    }
  });
  const baseline = layoutAssociationPageGraph(impossible);
  const graph = layoutConstrainedAssociationPageGraph(impossible);

  expect(graph.layoutSource).toBe("baseline");
  expect(graph.nodes).toEqual(baseline.nodes);
  expect(graph.edges).toEqual(baseline.edges);
});
