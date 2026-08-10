import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from "d3-force";

import {
  associationSectorAngle,
  evaluateAssociationGeometry,
  pointIsInSideSector,
  rectanglesWithinClearance,
  segmentsCross,
  type AssociationGeometryInput,
  type AssociationLayoutQuality,
  type AssociationSide
} from "./associationGraphGeometry";
import type {
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../thin-reading/thinReading.types";

/**
 * The page-level association graph, laid out in document coordinates.
 *
 * Two encodings, kept apart on purpose and unchanged from the gutter view:
 *   distance from the anchor  = `relevance`   (how related the work is)
 *   edge and node emphasis    = `confidence`  (how the link was established)
 * Mixing them would make a semantically-retrieved paper look like a cited one purely by sitting
 * close, which is the one misreading this whole view exists to prevent.
 *
 * A paper reached from several anchors is one node with several edges, not several nodes: the
 * crossing is the single thing a page-wide graph can show that a per-anchor nebula cannot.
 *
 * Everything here is pure and deterministic — no `Math.random`, no time, no DOM. The layout is
 * computed from anchor rectangles the renderer already measured, so scrolling never recomputes it.
 */

export type AnchorRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type PageGraphAnchorInput = {
  anchorId: string;
  /** Width of the anchor's label chip, so nodes are kept off the one thing that must stay legible. */
  labelWidth?: number;
  rect: AnchorRect;
};

export type PageGraphInput = {
  anchors: readonly PageGraphAnchorInput[];
  documentHeight: number;
  frameWidth: number;
  /** Deduplicated papers owned by more than one anchor must remain legible in the resting graph. */
  multiAnchorPaperKeys?: ReadonlySet<string>;
  /** Optional projection identity; source metadata remains untouched for rendering and actions. */
  paperKeyBySource?: ReadonlyMap<ThinReadingExternalSource, string>;
  /** Verified page-wide relations from the projection; every owner group shares this spring set. */
  paperEdges?: readonly PageGraphPaperRelation[];
  sourcesByAnchor: Readonly<Record<string, readonly ThinReadingExternalSource[]>>;
};

export type PageGraphPaperRelation = {
  directed: boolean;
  kind: ThinReadingRecommendationPaperEdge["kind"];
  sourcePaperKey: string;
  strength: number;
  targetPaperKey: string;
};

export type PageGraphNode = {
  /** Every anchor this paper was retrieved for. More than one means a crossing. */
  anchorIds: readonly string[];
  confidence: number;
  /** Weak links collapse to a dot so a dense page stays readable; they expand on hover. */
  isDot: boolean;
  left: number;
  paperKey: string;
  relevance: number;
  source: ThinReadingExternalSource;
  top: number;
};

export type PageGraphEdge = {
  anchorId: string;
  anchorLeft: number;
  anchorTop: number;
  confidence: number;
  crossing: boolean;
  nodeLeft: number;
  nodeTop: number;
  paperKey: string;
};

export type PageGraph = {
  edges: readonly PageGraphEdge[];
  /** Papers left out of an anchor's fan, so the count can be said out loud instead of vanishing. */
  hiddenCountByAnchor: Readonly<Record<string, number>>;
  nodes: readonly PageGraphNode[];
};

export type PageGraphPaperEdge = PageGraphPaperRelation & {
  sourceLeft: number;
  sourceTop: number;
  targetLeft: number;
  targetTop: number;
};

export type ConstrainedPageGraph = PageGraph & {
  baselineQuality: AssociationLayoutQuality;
  candidateQuality: AssociationLayoutQuality;
  layoutSource: "baseline" | "constrained";
  paperEdges: readonly PageGraphPaperEdge[];
  quality: AssociationLayoutQuality;
  searchDiagnostics: AssociationLayoutSearchDiagnostics;
};

export type AssociationLayoutSearchDiagnostics = {
  initialSlotCandidateEvaluations: number;
  repairCandidateEvaluations: number;
  repairNodesVisited: number;
  repairRounds: number;
  sideVariantsEvaluated: number;
  softVariantsEvaluated: number;
};

/**
 * Kept in step with `--association-node-width/height` in app.css. The height is the *tallest* a
 * card gets in Chromium — crossing badge, year, two title lines, padding, and borders — because a
 * layout that reserves the average height overlaps exactly on the cards that carry the most.
 */
export const pageGraphNodeWidth = 152;
export const pageGraphNodeHeight = 100;
export const pageGraphDotSize = 14;
export const maximumPageGraphSources = 8;
export const maximumAssociationSideVariants = 24;

const nodeGap = 10;
const frameInsetHorizontal = 10;
const frameInsetVertical = 8;

const nearRadius = 158;
const radiusSpread = 152;
const dotThreshold = 0.34;
const relaxationStep = 26;
const relaxationRounds = 24;
const maximumRepairRounds = 5;

const initialRelativeAngles = Array.from({ length: 23 }, (_, index) => (index - 11) * 5)
  .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right)
  .map((degrees) => degrees * Math.PI / 180);
const initialRadiusOffsets = Array.from({ length: 61 }, (_, index) => index * 8);
const repairCoarseRelativeAngles = Array.from({ length: 23 }, (_, index) => (index - 11) * 5)
  .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right)
  .map((degrees) => degrees * Math.PI / 180);
const repairCoarseRadiusOffsets = Array.from({ length: 31 }, (_, index) => index * 16);
const repairFineRadiusOffsets = [-8, 8];

/**
 * Fan directions, in degrees, biased away from straight up and down.
 *
 * Anchors stack vertically down a column of text, so a node placed directly above one lands on
 * the anchor above it. Sideways slots keep the fans of neighbouring anchors from colliding before
 * relaxation has to do anything.
 */
const fanAngles = [-34, 34, -146, 146, -8, 8, -172, 172, -68, 68, -112, 112];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

/** The identity used to merge the same work retrieved for different anchors. */
export function pageGraphPaperKey(source: ThinReadingExternalSource) {
  return source.canonicalPaperId ?? source.doi ?? source.id;
}

function anchorCentre(rect: AnchorRect) {
  return { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 };
}

/** A box around a centre, in document pixels. Used for both nodes and the anchors they avoid. */
type OccupiedBox = {
  halfHeight: number;
  halfWidth: number;
  left: number;
  top: number;
};

/**
 * A compact node still reserves its full focused footprint. The visible dot is only progressive
 * disclosure; keyboard or pointer focus must not expand it over another paper or anchor.
 */
function nodeBox(_isDot: boolean, left: number, top: number): OccupiedBox {
  return {
    halfHeight: pageGraphNodeHeight / 2,
    halfWidth: pageGraphNodeWidth / 2,
    left,
    top
  };
}

function overlaps(candidate: OccupiedBox, placed: OccupiedBox) {
  return Math.abs(candidate.left - placed.left) < candidate.halfWidth + placed.halfWidth + nodeGap &&
    Math.abs(candidate.top - placed.top) < candidate.halfHeight + placed.halfHeight + nodeGap;
}

/**
 * The anchor's own text and its label chip, which nothing may sit on: covering the anchor would
 * hide the very thing every edge on the page points at.
 */
function anchorObstacles(anchor: PageGraphAnchorInput): OccupiedBox[] {
  const { rect } = anchor;
  const centreTop = rect.top + rect.height / 2;
  const chipWidth = Math.max(rect.width, anchor.labelWidth ?? 0);
  return [
    {
      halfHeight: Math.max(rect.height, 22) / 2,
      halfWidth: rect.width / 2,
      left: rect.left + rect.width / 2,
      top: centreTop
    },
    {
      halfHeight: 15,
      halfWidth: chipWidth / 2,
      left: rect.left - 6 + chipWidth / 2,
      top: centreTop
    }
  ];
}

export function layoutAssociationPageGraph({
  anchors,
  documentHeight,
  frameWidth,
  multiAnchorPaperKeys,
  paperKeyBySource,
  sourcesByAnchor
}: PageGraphInput): PageGraph {
  const hiddenCountByAnchor: Record<string, number> = {};
  type Placement = {
    anchorId: string;
    angle: number;
    confidence: number;
    isDot: boolean;
    left: number;
    paperKey: string;
    relevance: number;
    source: ThinReadingExternalSource;
    top: number;
  };
  const placements: Placement[] = [];

  for (const anchor of anchors) {
    const all = [...(sourcesByAnchor[anchor.anchorId] ?? [])].sort(
      (left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id)
    );
    const visible = all.slice(0, maximumPageGraphSources);
    if (all.length > visible.length) {
      hiddenCountByAnchor[anchor.anchorId] = all.length - visible.length;
    }
    if (visible.length === 0) continue;

    const centre = anchorCentre(anchor.rect);
    const highest = visible[0].relevance;
    const lowest = visible[visible.length - 1].relevance;
    const spread = highest - lowest;
    // An anchor sitting right of centre fans left first, and the other way round, so the strongest
    // results land in the wider half of the page instead of being clamped against an edge.
    const prefersLeft = centre.left > frameWidth / 2;
    // The same argument vertically. An anchor in the first paragraph has nothing above it, and a
    // fan that opens upward there ends up clamped into a single line along the top edge.
    const verticalRoom = centre.top < documentHeight * 0.4
      ? "below"
      : centre.top > documentHeight * 0.72 ? "above" : "either";

    visible.forEach((source, index) => {
      const relevance = clamp(source.relevance, 0, 1);
      const normalizedDistance = spread >= 0.02 ? (highest - relevance) / spread : index / Math.max(1, visible.length - 1);
      const radius = nearRadius + normalizedDistance * radiusSpread;
      const fanAngle = fanAngles[index % fanAngles.length];
      const rawAngle = verticalRoom === "below"
        ? Math.abs(fanAngle)
        : verticalRoom === "above" ? -Math.abs(fanAngle) : fanAngle;
      const angle = (prefersLeft ? 180 - rawAngle : rawAngle) * Math.PI / 180;
      const paperKey = paperKeyBySource?.get(source) ?? pageGraphPaperKey(source);
      placements.push({
        anchorId: anchor.anchorId,
        angle,
        confidence: clamp(source.confidence ?? 0.3, 0, 1),
        isDot: !multiAnchorPaperKeys?.has(paperKey) &&
          (frameWidth < 520 || normalizedDistance > dotThreshold),
        left: centre.left + Math.cos(angle) * radius,
        paperKey,
        relevance,
        source,
        top: centre.top + Math.sin(angle) * radius
      });
    });
  }

  // Merge before relaxing: a crossing paper has to be one obstacle, not two overlapping ones.
  const merged = new Map<string, {
    anchorIds: string[];
    angle: number;
    confidence: number;
    isDot: boolean;
    left: number;
    relevance: number;
    source: ThinReadingExternalSource;
    top: number;
  }>();
  for (const placement of placements) {
    const existing = merged.get(placement.paperKey);
    if (!existing) {
      merged.set(placement.paperKey, {
        anchorIds: [placement.anchorId],
        angle: placement.angle,
        confidence: placement.confidence,
        isDot: placement.isDot,
        left: placement.left,
        relevance: placement.relevance,
        source: placement.source,
        top: placement.top
      });
      continue;
    }
    const count = existing.anchorIds.length;
    existing.anchorIds.push(placement.anchorId);
    existing.left = (existing.left * count + placement.left) / (count + 1);
    existing.top = (existing.top * count + placement.top) / (count + 1);
    // A crossing is never a dot, and it keeps the strongest evidence of its links.
    existing.isDot = false;
    existing.confidence = Math.max(existing.confidence, placement.confidence);
    if (placement.relevance > existing.relevance) {
      existing.relevance = placement.relevance;
      existing.source = placement.source;
    }
  }

  const anchorCentreById = new Map(
    anchors.map((anchor) => [anchor.anchorId, anchorCentre(anchor.rect)] as const)
  );
  const horizontalLimit = pageGraphNodeWidth / 2 + 10;
  const verticalLimit = pageGraphNodeHeight / 2 + 8;

  const ordered = [...merged.entries()].sort(([leftKey, left], [rightKey, right]) =>
    right.anchorIds.length - left.anchorIds.length ||
    right.relevance - left.relevance ||
    leftKey.localeCompare(rightKey));

  const occupied: OccupiedBox[] = anchors.flatMap(anchorObstacles);
  const clampLeft = (value: number) =>
    clamp(value, horizontalLimit, Math.max(horizontalLimit, frameWidth - horizontalLimit));
  const clampTop = (value: number) =>
    clamp(value, verticalLimit, Math.max(verticalLimit, documentHeight - verticalLimit));

  const settled: PageGraphNode[] = [];
  for (const [paperKey, entry] of ordered) {
    let left = clampLeft(entry.left);
    let top = clampTop(entry.top);
    /*
     * Displaced along its own fan direction *and* turned a little each round, so a node pushed
     * into an edge walks along it instead of piling up against it. Clamping happens inside the
     * loop, not after it: clamping a resolved position afterwards is exactly how three nodes end
     * up stacked on the same pixel at the top of a short article.
     */
    for (let round = 1; round <= relaxationRounds; round += 1) {
      if (!occupied.some((box) => overlaps(nodeBox(entry.isDot, left, top), box))) break;
      const spin = entry.angle + round * 0.55;
      const distance = round * relaxationStep;
      left = clampLeft(entry.left + Math.cos(spin) * distance);
      top = clampTop(entry.top + Math.sin(spin) * distance);
    }
    const placed = {
      anchorIds: entry.anchorIds,
      confidence: entry.confidence,
      isDot: entry.isDot,
      left,
      paperKey,
      relevance: entry.relevance,
      source: entry.source,
      top
    };
    settled.push(placed);
    occupied.push(nodeBox(placed.isDot, placed.left, placed.top));
  }

  const edges: PageGraphEdge[] = [];
  for (const node of settled) {
    for (const anchorId of node.anchorIds) {
      const centre = anchorCentreById.get(anchorId);
      if (!centre) continue;
      edges.push({
        anchorId,
        anchorLeft: centre.left,
        anchorTop: centre.top,
        confidence: node.confidence,
        crossing: node.anchorIds.length > 1,
        nodeLeft: node.left,
        nodeTop: node.top,
        paperKey: node.paperKey
      });
    }
  }

  return { edges, hiddenCountByAnchor, nodes: settled };
}

function geometryInput(
  input: PageGraphInput,
  graph: PageGraph
): AssociationGeometryInput {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.paperKey, node] as const));
  return {
    anchors: input.anchors.map((anchor) => {
      const centre = anchorCentre(anchor.rect);
      return {
        anchorId: anchor.anchorId,
        ...centre,
        obstacles: anchorObstacles(anchor).map((obstacle) => ({
          bottom: obstacle.top + obstacle.halfHeight,
          left: obstacle.left - obstacle.halfWidth,
          right: obstacle.left + obstacle.halfWidth,
          top: obstacle.top - obstacle.halfHeight
        }))
      };
    }),
    frameHeight: input.documentHeight,
    frameInsetHorizontal,
    frameInsetVertical,
    frameWidth: input.frameWidth,
    nodeClearance: nodeGap,
    nodes: graph.nodes.map((node) => {
      const box = nodeBox(node.isDot, node.left, node.top);
      return {
        frameHalfHeight: pageGraphNodeHeight / 2,
        frameHalfWidth: pageGraphNodeWidth / 2,
        halfHeight: box.halfHeight,
        halfWidth: box.halfWidth,
        left: node.left,
        paperKey: node.paperKey,
        relevance: node.relevance,
        top: node.top
      };
    }),
    paperEdges: (input.paperEdges ?? []).filter((edge) =>
      nodeByKey.has(edge.sourcePaperKey) && nodeByKey.has(edge.targetPaperKey)),
    primaryEdges: graph.nodes.flatMap((node) => node.anchorIds[0]
      ? [{ anchorId: node.anchorIds[0], paperKey: node.paperKey }]
      : [])
  };
}

export function evaluateAssociationLayout(input: PageGraphInput, graph: PageGraph) {
  return evaluateAssociationGeometry(geometryInput(input, graph));
}

function hardViolationCount(quality: AssociationLayoutQuality) {
  return quality.primaryEdgeCrossings + quality.sameSideViolations + quality.nodeOverlaps +
    quality.anchorObstructions + quality.overflowCount;
}

/** Returns only nodes that can affect a current hard violation. */
function hardViolationPaperKeys(
  input: PageGraphInput,
  graph: PageGraph,
  sideByAnchor: ReadonlyMap<string, AssociationSide>
) {
  const result = new Set<string>();
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const rectangles = graph.nodes.map((node) => ({
    bottom: node.top + pageGraphNodeHeight / 2,
    left: node.left - pageGraphNodeWidth / 2,
    right: node.left + pageGraphNodeWidth / 2,
    top: node.top - pageGraphNodeHeight / 2
  }));
  rectangles.forEach((rectangle, index) => {
    const node = graph.nodes[index]!;
    if (rectangle.left < frameInsetHorizontal ||
        rectangle.right > input.frameWidth - frameInsetHorizontal ||
        rectangle.top < frameInsetVertical ||
        rectangle.bottom > input.documentHeight - frameInsetVertical) {
      result.add(node.paperKey);
    }
    for (const anchor of input.anchors) {
      if (anchorObstacles(anchor).some((obstacle) => rectanglesWithinClearance(rectangle, {
        bottom: obstacle.top + obstacle.halfHeight,
        left: obstacle.left - obstacle.halfWidth,
        right: obstacle.left + obstacle.halfWidth,
        top: obstacle.top - obstacle.halfHeight
      }, nodeGap))) {
        result.add(node.paperKey);
        break;
      }
    }
  });
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      if (rectanglesWithinClearance(rectangles[leftIndex]!, rectangles[rightIndex]!, nodeGap)) {
        result.add(graph.nodes[leftIndex]!.paperKey);
        result.add(graph.nodes[rightIndex]!.paperKey);
      }
    }
  }

  const primarySegments = graph.nodes.flatMap((node) => {
    const anchorId = node.anchorIds[0];
    const anchor = anchorId ? anchorById.get(anchorId) : undefined;
    if (!anchorId || !anchor) return [];
    const centre = anchorCentre(anchor.rect);
    const side = sideByAnchor.get(anchorId);
    if (side && !pointIsInSideSector(centre, node, side)) result.add(node.paperKey);
    return [{ anchorId, end: node, paperKey: node.paperKey, start: centre }];
  });
  for (let leftIndex = 0; leftIndex < primarySegments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < primarySegments.length; rightIndex += 1) {
      const left = primarySegments[leftIndex]!;
      const right = primarySegments[rightIndex]!;
      if (segmentsCross(left, right)) {
        result.add(left.paperKey);
        result.add(right.paperKey);
      }
    }
  }
  return result;
}

function stressByPaperKey(input: PageGraphInput, graph: PageGraph) {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.paperKey, node] as const));
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const result = new Map(graph.nodes.map((node) => {
    const anchorId = node.anchorIds[0];
    const anchor = anchorId ? anchorById.get(anchorId) : undefined;
    if (!anchor) return [node.paperKey, 0] as const;
    const centre = anchorCentre(anchor.rect);
    const ideal = nearRadius + (1 - node.relevance) * radiusSpread;
    return [node.paperKey, 3 * (Math.hypot(node.left - centre.left, node.top - centre.top) - ideal) ** 2 /
      ideal ** 2] as const;
  }));
  for (const edge of input.paperEdges ?? []) {
    const source = nodeByKey.get(edge.sourcePaperKey);
    const target = nodeByKey.get(edge.targetPaperKey);
    if (!source || !target) continue;
    const ideal = 108 + (1 - clamp(edge.strength, 0, 1)) * 172;
    const stress = ((Math.hypot(source.left - target.left, source.top - target.top) - ideal) / ideal) ** 2 / 2;
    result.set(edge.sourcePaperKey, (result.get(edge.sourcePaperKey) ?? 0) + stress);
    result.set(edge.targetPaperKey, (result.get(edge.targetPaperKey) ?? 0) + stress);
  }
  return result;
}

function softRepairPaperKeys(
  input: PageGraphInput,
  graph: PageGraph,
  baseline: PageGraph,
  quality: AssociationLayoutQuality,
  baselineQuality: AssociationLayoutQuality
) {
  const result = new Set<string>();
  const nodeByKey = new Map(graph.nodes.map((node) => [node.paperKey, node] as const));
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const segments = graph.nodes.flatMap((node) => {
    const anchorId = node.anchorIds[0];
    const anchor = anchorId ? anchorById.get(anchorId) : undefined;
    return anchor ? [{ end: node, paperKeys: [node.paperKey], start: anchorCentre(anchor.rect) }] : [];
  });
  for (const edge of input.paperEdges ?? []) {
    const source = nodeByKey.get(edge.sourcePaperKey);
    const target = nodeByKey.get(edge.targetPaperKey);
    if (source && target) segments.push({
      end: target,
      paperKeys: [edge.sourcePaperKey, edge.targetPaperKey],
      start: source
    });
  }
  if (quality.weightedCrossings > baselineQuality.weightedCrossings) {
    for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
        const left = segments[leftIndex]!;
        const right = segments[rightIndex]!;
        if (segmentsCross(left, right)) {
          left.paperKeys.forEach((paperKey) => result.add(paperKey));
          right.paperKeys.forEach((paperKey) => result.add(paperKey));
        }
      }
    }
  }
  if (quality.weightedStress > baselineQuality.weightedStress + 1e-9) {
    const candidateStress = stressByPaperKey(input, graph);
    const baselineStress = stressByPaperKey(input, baseline);
    [...candidateStress].map(([paperKey, stress]) => [
      paperKey,
      stress - (baselineStress.get(paperKey) ?? 0)
    ] as const).filter(([, excess]) => excess > 1e-9)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .forEach(([paperKey]) => result.add(paperKey));
    for (const edge of input.paperEdges ?? []) {
      if (nodeByKey.has(edge.sourcePaperKey) && nodeByKey.has(edge.targetPaperKey)) {
        result.add(edge.sourcePaperKey);
        result.add(edge.targetPaperKey);
      }
    }
  }
  return result;
}

function expandRepairConstraintClosure(
  input: PageGraphInput,
  graph: PageGraph,
  paperKeys: Set<string>
) {
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  let closureChanged = true;
  while (closureChanged) {
    closureChanged = false;
    const selectedAnchorIds = new Set(graph.nodes.filter((node) => paperKeys.has(node.paperKey))
      .flatMap((node) => node.anchorIds[0] ?? []));
    for (const node of graph.nodes) {
      const anchorId = node.anchorIds[0];
      if (!anchorId || paperKeys.has(node.paperKey)) continue;
      const anchor = anchorById.get(anchorId);
      const neighboursSelectedAnchor = anchor && [...selectedAnchorIds].some((selectedAnchorId) => {
        const selectedAnchor = anchorById.get(selectedAnchorId);
        return selectedAnchor && Math.abs(
          anchorCentre(anchor.rect).top - anchorCentre(selectedAnchor.rect).top
        ) <= pageGraphNodeHeight * 2 + nodeGap;
      });
      if (selectedAnchorIds.has(anchorId) || neighboursSelectedAnchor) {
        paperKeys.add(node.paperKey);
        closureChanged = true;
      }
    }
  }
}

type ForceNode = SimulationNodeDatum & {
  anchorId?: string;
  id: string;
  isAnchor: boolean;
  paperKey?: string;
};

type ForceLink = SimulationLinkDatum<ForceNode> & {
  distance: number;
  strength: number;
};

function stableRandom(seedText: string) {
  let state = 2166136261;
  for (const character of seedText) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = Math.imul(state, 1664525) + 1013904223 | 0;
    return (state >>> 0) / 4294967296;
  };
}

function sideAssignments(input: PageGraphInput, baseline: PageGraph) {
  const nodesByAnchor = new Map<string, PageGraphNode[]>();
  for (const node of baseline.nodes) {
    const anchorId = node.anchorIds[0];
    if (anchorId) nodesByAnchor.set(anchorId, [...(nodesByAnchor.get(anchorId) ?? []), node]);
  }
  const ordered = [...input.anchors]
    .filter((anchor) => (nodesByAnchor.get(anchor.anchorId)?.length ?? 0) > 0)
    .sort((left, right) => left.rect.top - right.rect.top || left.anchorId.localeCompare(right.anchorId));
  if (ordered.length === 0) return new Map<string, AssociationSide>();

  type State = { cost: number; path: AssociationSide[] };
  let states: Record<AssociationSide, State> = {
    left: { cost: 0, path: [] },
    right: { cost: 0, path: [] }
  };
  ordered.forEach((anchor, index) => {
    const centre = anchorCentre(anchor.rect);
    const count = nodesByAnchor.get(anchor.anchorId)!.length;
    const local = (side: AssociationSide) => {
      const room = side === "left" ? centre.left : input.frameWidth - centre.left;
      const congestion = Math.max(0, 190 - room) * count;
      const expectedEdgeLength = nodesByAnchor.get(anchor.anchorId)!.reduce((sum, node) => {
        const ideal = nearRadius + (1 - node.relevance) * radiusSpread;
        const targetLeft = centre.left + (side === "right" ? ideal : -ideal);
        return sum + Math.abs(targetLeft - node.left) * 0.08;
      }, 0);
      return congestion + expectedEdgeLength;
    };
    if (index === 0) {
      states = {
        left: { cost: local("left"), path: ["left"] },
        right: { cost: local("right"), path: ["right"] }
      };
      return;
    }
    const previousAnchor = ordered[index - 1]!;
    const verticalGap = Math.abs(anchorCentre(previousAnchor.rect).top - centre.top);
    const transitionPenalty = verticalGap < 360 ? 90 : 20;
    const next = {} as Record<AssociationSide, State>;
    for (const side of ["left", "right"] as const) {
      const alternatives = (["left", "right"] as const).map((previousSide) => ({
        cost: states[previousSide].cost + local(side) +
          (previousSide === side ? transitionPenalty : 0),
        path: [...states[previousSide].path, side]
      })).sort((left, right) => left.cost - right.cost || left.path.join().localeCompare(right.path.join()));
      next[side] = alternatives[0]!;
    }
    states = next;
  });
  const selected = [states.left, states.right]
    .sort((left, right) => left.cost - right.cost || left.path.join().localeCompare(right.path.join()))[0]!;
  return new Map(ordered.map((anchor, index) => [anchor.anchorId, selected.path[index]!] as const));
}

function sideVariantSignature(variant: ReadonlyMap<string, AssociationSide>) {
  return [...variant].sort(([left], [right]) => left.localeCompare(right))
    .map(([anchorId, side]) => `${anchorId}:${side}`).join("|");
}

/**
 * Produces a fixed-budget deterministic search neighbourhood around the preferred assignment.
 * Priority is supplied by the caller because anchor value belongs to the graph, not this combinator.
 */
export function createAssociationSideVariants(
  preferredSides: ReadonlyMap<string, AssociationSide>,
  anchorPriority: readonly string[] = [...preferredSides.keys()].sort()
) {
  const orderedAnchorIds = [
    ...new Set([
      ...anchorPriority.filter((anchorId) => preferredSides.has(anchorId)),
      ...[...preferredSides.keys()].sort()
    ])
  ];
  const variants: Map<string, AssociationSide>[] = [];
  const signatures = new Set<string>();
  const addVariant = (flippedAnchorIds: ReadonlySet<string>) => {
    const variant = new Map([...preferredSides].map(([anchorId, side]) => [
      anchorId,
      flippedAnchorIds.has(anchorId) ? side === "left" ? "right" : "left" : side
    ] as const));
    const signature = sideVariantSignature(variant);
    if (signatures.has(signature) || variants.length >= maximumAssociationSideVariants) return;
    signatures.add(signature);
    variants.push(variant);
  };

  addVariant(new Set());
  addVariant(new Set(orderedAnchorIds));

  const mutations = orderedAnchorIds.map((anchorId, priority) => ({
    anchorIds: [anchorId],
    priority
  }));
  for (let first = 0; first < orderedAnchorIds.length; first += 1) {
    for (let second = first + 1; second < orderedAnchorIds.length; second += 1) {
      mutations.push({
        anchorIds: [orderedAnchorIds[first]!, orderedAnchorIds[second]!],
        priority: first + second
      });
    }
  }
  mutations.sort((left, right) => left.priority - right.priority ||
    left.anchorIds.length - right.anchorIds.length ||
    left.anchorIds.join("\u0000").localeCompare(right.anchorIds.join("\u0000")));
  for (const mutation of mutations) {
    addVariant(new Set(mutation.anchorIds));
    if (variants.length >= maximumAssociationSideVariants) break;
  }
  return variants;
}

function projectToSector(
  node: ForceNode,
  anchor: ForceNode,
  side: AssociationSide,
  input: PageGraphInput
) {
  const halfWidth = pageGraphNodeWidth / 2;
  const halfHeight = pageGraphNodeHeight / 2;
  let dx = (node.x ?? anchor.x!) - anchor.x!;
  let dy = (node.y ?? anchor.y!) - anchor.y!;
  if (dx === 0 && dy === 0) dx = side === "right" ? 1 : -1;
  let radius = Math.max(96, Math.hypot(dx, dy));
  const centreAngle = side === "right" ? 0 : Math.PI;
  const relative = Math.atan2(Math.sin(Math.atan2(dy, dx) - centreAngle), Math.cos(Math.atan2(dy, dx) - centreAngle));
  const angle = centreAngle + clamp(relative, -associationSectorAngle, associationSectorAngle);
  node.x = clamp(
    anchor.x! + Math.cos(angle) * radius,
    halfWidth + frameInsetHorizontal,
    input.frameWidth - halfWidth - frameInsetHorizontal
  );
  node.y = clamp(
    anchor.y! + Math.sin(angle) * radius,
    halfHeight + frameInsetVertical,
    input.documentHeight - halfHeight - frameInsetVertical
  );
  dx = node.x - anchor.x!;
  dy = node.y - anchor.y!;
  if ((side === "right" && dx <= 0) || (side === "left" && dx >= 0)) {
    radius = Math.max(radius, halfWidth + 24);
    node.x = clamp(
      anchor.x! + (side === "right" ? radius : -radius),
      halfWidth + frameInsetHorizontal,
      input.frameWidth - halfWidth - frameInsetHorizontal
    );
    node.y = clamp(
      anchor.y!,
      halfHeight + frameInsetVertical,
      input.documentHeight - halfHeight - frameInsetVertical
    );
  }
}

function candidateGraph(
  input: PageGraphInput,
  baseline: PageGraph,
  baselineQuality: AssociationLayoutQuality,
  sideByAnchor: ReadonlyMap<string, AssociationSide>,
  diagnostics: AssociationLayoutSearchDiagnostics,
  repairMode: "none" | "soft"
): PageGraph {
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const forceNodes: ForceNode[] = input.anchors.map((anchor) => {
    const centre = anchorCentre(anchor.rect);
    return { anchorId: anchor.anchorId, fx: centre.left, fy: centre.top, id: `anchor:${anchor.anchorId}`,
      isAnchor: true, x: centre.left, y: centre.top };
  });
  const forceNodeByPaperKey = new Map<string, ForceNode>();
  const grouped = new Map<string, PageGraphNode[]>();
  for (const node of baseline.nodes) {
    const anchorId = node.anchorIds[0];
    if (anchorId) grouped.set(anchorId, [...(grouped.get(anchorId) ?? []), node]);
  }
  for (const [anchorId, nodes] of grouped) {
    const anchor = anchorById.get(anchorId);
    const side = sideByAnchor.get(anchorId);
    if (!anchor || !side) continue;
    const ordered = [...nodes].sort((left, right) => right.relevance - left.relevance ||
      left.paperKey.localeCompare(right.paperKey));
    ordered.forEach((graphNode) => {
      const forceNode: ForceNode = {
        id: `paper:${graphNode.paperKey}`,
        isAnchor: false,
        paperKey: graphNode.paperKey,
        x: graphNode.left,
        y: graphNode.top
      };
      forceNodes.push(forceNode);
      forceNodeByPaperKey.set(graphNode.paperKey, forceNode);
    });
  }
  const forceNodeById = new Map(forceNodes.map((node) => [node.id, node] as const));
  const forceLinks: ForceLink[] = [];
  for (const graphNode of baseline.nodes) {
    const anchorId = graphNode.anchorIds[0];
    if (!anchorId || !forceNodeByPaperKey.has(graphNode.paperKey)) continue;
    forceLinks.push({
      distance: nearRadius + (1 - graphNode.relevance) * radiusSpread,
      source: `anchor:${anchorId}`,
      strength: 0.86,
      target: `paper:${graphNode.paperKey}`
    });
  }
  for (const edge of input.paperEdges ?? []) {
    if (!forceNodeByPaperKey.has(edge.sourcePaperKey) || !forceNodeByPaperKey.has(edge.targetPaperKey)) continue;
    forceLinks.push({
      distance: 108 + (1 - clamp(edge.strength, 0, 1)) * 172,
      source: `paper:${edge.sourcePaperKey}`,
      strength: 0.12 + clamp(edge.strength, 0, 1) * 0.2,
      target: `paper:${edge.targetPaperKey}`
    });
  }
  const simulation = forceSimulation(forceNodes)
    .randomSource(stableRandom(forceNodes.map((node) => node.id).sort().join("\u0000")))
    .alpha(0.7)
    .alphaDecay(0.055)
    .velocityDecay(0.46)
    .force("charge", forceManyBody<ForceNode>().strength((node) => node.isAnchor ? 0 : -12))
    .force("collision", forceCollide<ForceNode>().radius((node) =>
      node.isAnchor ? 30 : pageGraphNodeHeight / 2 + 5).iterations(2))
    .force("links", forceLink<ForceNode, ForceLink>(forceLinks)
      .id((node) => node.id)
      .distance((link) => link.distance)
      .strength((link) => link.strength))
    .stop();
  for (let tick = 0; tick < 72; tick += 1) {
    simulation.tick();
    for (const graphNode of baseline.nodes) {
      const anchorId = graphNode.anchorIds[0];
      const anchor = anchorId ? forceNodeById.get(`anchor:${anchorId}`) : undefined;
      const node = forceNodeByPaperKey.get(graphNode.paperKey);
      const side = anchorId ? sideByAnchor.get(anchorId) : undefined;
      if (anchor && node && side) projectToSector(node, anchor, side, input);
    }
  }

  // Circular collision forces are intentionally only a first pass. Cards are rectangles, so each
  // one snaps to the nearest exact legal polar slot while retaining the force result as a tie-break.
  const collisionOrder = [...baseline.nodes].sort((left, right) =>
    right.relevance - left.relevance || left.paperKey.localeCompare(right.paperKey));
  const rectangleAt = (_graphNode: PageGraphNode, left: number, top: number) => {
    const halfWidth = pageGraphNodeWidth / 2;
    const halfHeight = pageGraphNodeHeight / 2;
    return {
      bottom: top + halfHeight,
      left: left - halfWidth,
      right: left + halfWidth,
      top: top - halfHeight
    };
  };
  const placedRectangles = input.anchors.flatMap(anchorObstacles).map((obstacle) => ({
    bottom: obstacle.top + obstacle.halfHeight,
    left: obstacle.left - obstacle.halfWidth,
    right: obstacle.left + obstacle.halfWidth,
    top: obstacle.top - obstacle.halfHeight
  }));
  const intersects = (left: ReturnType<typeof rectangleAt>, right: ReturnType<typeof rectangleAt>) =>
    left.left < right.right + nodeGap && left.right > right.left - nodeGap &&
    left.top < right.bottom + nodeGap && left.bottom > right.top - nodeGap;
  const relationsByPaperKey = new Map<string, PageGraphPaperRelation[]>();
  for (const relation of input.paperEdges ?? []) {
    relationsByPaperKey.set(relation.sourcePaperKey, [
      ...(relationsByPaperKey.get(relation.sourcePaperKey) ?? []),
      relation
    ]);
    relationsByPaperKey.set(relation.targetPaperKey, [
      ...(relationsByPaperKey.get(relation.targetPaperKey) ?? []),
      relation
    ]);
  }
  for (const graphNode of collisionOrder) {
    const anchorId = graphNode.anchorIds[0];
    const anchor = anchorId ? forceNodeById.get(`anchor:${anchorId}`) : undefined;
    const node = forceNodeByPaperKey.get(graphNode.paperKey);
    const side = anchorId ? sideByAnchor.get(anchorId) : undefined;
    if (!anchor || !node || !side) continue;
    const forceLeft = node.x!;
    const forceTop = node.y!;
    const ideal = nearRadius + (1 - graphNode.relevance) * radiusSpread;
    const seenCandidates = new Set<string>();
    const evaluateSlot = (relativeAngle: number, radius: number) => {
      const signature = `${relativeAngle.toFixed(6)}:${radius.toFixed(3)}`;
      if (seenCandidates.has(signature) || radius < 96 ||
          Math.abs(relativeAngle) > associationSectorAngle + 1e-9) return undefined;
      seenCandidates.add(signature);
      diagnostics.initialSlotCandidateEvaluations += 1;
      const angle = (side === "right" ? 0 : Math.PI) + relativeAngle;
      const left = anchor.x! + Math.cos(angle) * radius;
      const top = anchor.y! + Math.sin(angle) * radius;
      const rectangle = rectangleAt(graphNode, left, top);
      const radialStress = ((radius - ideal) / ideal) ** 2;
      const forceDistance = Math.hypot(left - forceLeft, top - forceTop);
      const relationStress = (relationsByPaperKey.get(graphNode.paperKey) ?? []).reduce((sum, relation) => {
        const otherKey = relation.sourcePaperKey === graphNode.paperKey
          ? relation.targetPaperKey
          : relation.sourcePaperKey;
        const other = forceNodeByPaperKey.get(otherKey);
        if (!other) return sum;
        const relationIdeal = 108 + (1 - clamp(relation.strength, 0, 1)) * 172;
        const distance = Math.hypot(left - other.x!, top - other.y!);
        return sum + ((distance - relationIdeal) / relationIdeal) ** 2;
      }, 0);
      const insideFrame = left - pageGraphNodeWidth / 2 >= frameInsetHorizontal &&
        left + pageGraphNodeWidth / 2 <= input.frameWidth - frameInsetHorizontal &&
        top - pageGraphNodeHeight / 2 >= frameInsetVertical &&
        top + pageGraphNodeHeight / 2 <= input.documentHeight - frameInsetVertical;
      return {
        collisionCount: placedRectangles.filter((placed) => intersects(rectangle, placed)).length,
        forceDistance,
        insideFrame,
        left,
        radialStress,
        radius,
        rectangle,
        relativeAngle,
        score: radialStress * 3 + relationStress + forceDistance * 1e-6,
        top
      };
    };
    const candidates = initialRelativeAngles.flatMap((relativeAngle) =>
      initialRadiusOffsets.flatMap((radiusOffset) =>
        evaluateSlot(relativeAngle, ideal + radiusOffset) ?? []));
    candidates.sort((left, right) => Number(right.insideFrame) - Number(left.insideFrame) ||
      left.collisionCount - right.collisionCount || left.score - right.score ||
      left.radialStress - right.radialStress || left.forceDistance - right.forceDistance ||
      left.top - right.top || left.left - right.left);
    const legalCandidates = candidates.filter((candidate) =>
      candidate.insideFrame && candidate.collisionCount === 0);
    const selected = legalCandidates[0];
    if (selected) {
      node.x = selected.left;
      node.y = selected.top;
      placedRectangles.push(selected.rectangle);
    } else {
      placedRectangles.push(rectangleAt(graphNode, node.x!, node.y!));
    }
  }

  let nodes = baseline.nodes.map((node) => {
    const forceNode = forceNodeByPaperKey.get(node.paperKey);
    return forceNode ? { ...node, left: forceNode.x!, top: forceNode.y! } : node;
  });
  const graphFromNodes = (nextNodes: readonly PageGraphNode[]): PageGraph => {
    const nodeByKey = new Map(nextNodes.map((node) => [node.paperKey, node] as const));
    return {
      edges: baseline.edges.map((edge) => {
        const node = nodeByKey.get(edge.paperKey);
        return node ? { ...edge, nodeLeft: node.left, nodeTop: node.top } : edge;
      }),
      hiddenCountByAnchor: baseline.hiddenCountByAnchor,
      nodes: nextNodes
    };
  };

  // A stable adjacent swap pass reduces global crossings without moving a paper outside its
  // owner's selected sector. Equal crossing counts keep the current relevance-distance order.
  let graph = graphFromNodes(nodes);
  let quality = evaluateAssociationLayout(input, graph);
  const compareQuality = (left: AssociationLayoutQuality, right: AssociationLayoutQuality) =>
    left.overflowCount - right.overflowCount ||
    left.nodeOverlaps - right.nodeOverlaps ||
    left.anchorObstructions - right.anchorObstructions ||
    left.sameSideViolations - right.sameSideViolations ||
    left.primaryEdgeCrossings - right.primaryEdgeCrossings ||
    hardViolationCount(left) - hardViolationCount(right) ||
    left.weightedCrossings - right.weightedCrossings ||
    left.weightedStress - right.weightedStress;

  // Greedy rectangle placement can leave one late node without a legal slot on a dense line of
  // adjacent anchors. A deterministic local repair lets every node try the same sector lattice
  // against the completed graph, accepting only an objectively better measured layout.
  for (let round = 0; repairMode !== "none" && round < maximumRepairRounds; round += 1) {
    const violatingPaperKeys = hardViolationPaperKeys(input, graph, sideByAnchor);
    if (repairMode === "soft") {
      softRepairPaperKeys(input, graph, baseline, quality, baselineQuality)
        .forEach((paperKey) => violatingPaperKeys.add(paperKey));
      expandRepairConstraintClosure(input, graph, violatingPaperKeys);
    }
    if (violatingPaperKeys.size === 0) break;
    diagnostics.repairRounds += 1;
    let roundImproved = false;
    const repairOrder = nodes.filter((node) => violatingPaperKeys.has(node.paperKey))
      .sort((left, right) =>
      Number(right.isDot) - Number(left.isDot) || left.relevance - right.relevance ||
      left.paperKey.localeCompare(right.paperKey));
    for (const repairNode of repairOrder) {
      diagnostics.repairNodesVisited += 1;
      const nodeIndex = nodes.findIndex((node) => node.paperKey === repairNode.paperKey);
      const anchorId = repairNode.anchorIds[0];
      const anchor = anchorId ? anchorById.get(anchorId) : undefined;
      const side = anchorId ? sideByAnchor.get(anchorId) : undefined;
      if (nodeIndex < 0 || !anchor || !side) continue;
      const centre = anchorCentre(anchor.rect);
      const ideal = nearRadius + (1 - repairNode.relevance) * radiusSpread;
      let bestNodes = nodes;
      let bestGraph = graph;
      let bestQuality = quality;
      const seenCandidates = new Set<string>();
      const evaluateRepairSlot = (relativeAngle: number, radius: number) => {
        const signature = `${relativeAngle.toFixed(6)}:${radius.toFixed(3)}`;
        if (seenCandidates.has(signature) || radius < 96 ||
            Math.abs(relativeAngle) > associationSectorAngle + 1e-9) return undefined;
        seenCandidates.add(signature);
        const angle = (side === "right" ? 0 : Math.PI) + relativeAngle;
        const candidateNode = {
          ...repairNode,
          left: centre.left + Math.cos(angle) * radius,
          top: centre.top + Math.sin(angle) * radius
        };
        if (candidateNode.left - pageGraphNodeWidth / 2 < frameInsetHorizontal ||
            candidateNode.left + pageGraphNodeWidth / 2 > input.frameWidth - frameInsetHorizontal ||
            candidateNode.top - pageGraphNodeHeight / 2 < frameInsetVertical ||
            candidateNode.top + pageGraphNodeHeight / 2 > input.documentHeight - frameInsetVertical) {
          return undefined;
        }
        diagnostics.repairCandidateEvaluations += 1;
        const candidateNodes = [...nodes];
        candidateNodes[nodeIndex] = candidateNode;
        const candidateGraph = graphFromNodes(candidateNodes);
        const candidateQuality = evaluateAssociationLayout(input, candidateGraph);
        const candidate = { candidateGraph, candidateNodes, candidateQuality, radius, relativeAngle };
        if (compareQuality(candidateQuality, bestQuality) < 0) {
          bestNodes = candidateNodes;
          bestGraph = candidateGraph;
          bestQuality = candidateQuality;
        }
        return candidate;
      };
      const activeRepairAngles = repairCoarseRelativeAngles;
      const activeRepairRadii = repairCoarseRadiusOffsets;
      const coarseCandidates = activeRepairAngles.flatMap((relativeAngle) =>
        activeRepairRadii.flatMap((radiusOffset) =>
          evaluateRepairSlot(relativeAngle, ideal + radiusOffset) ?? []));
      coarseCandidates.sort((left, right) => compareQuality(left.candidateQuality, right.candidateQuality) ||
        left.radius - right.radius || left.relativeAngle - right.relativeAngle);
      const seedByAngle = new Map<number, typeof coarseCandidates[number]>();
      for (const candidate of coarseCandidates) {
        if (!seedByAngle.has(candidate.relativeAngle)) seedByAngle.set(candidate.relativeAngle, candidate);
      }
      for (const seed of seedByAngle.values()) {
        for (const radiusOffset of repairFineRadiusOffsets) {
          evaluateRepairSlot(seed.relativeAngle, seed.radius + radiusOffset);
        }
      }
      nodes = bestNodes;
      graph = bestGraph;
      if (compareQuality(bestQuality, quality) < 0) roundImproved = true;
      quality = bestQuality;
    }
    if (!roundImproved) break;
  }
  for (const anchor of [...input.anchors].sort((left, right) => left.anchorId.localeCompare(right.anchorId))) {
    const paperKeys = nodes.filter((node) => node.anchorIds[0] === anchor.anchorId)
      .sort((left, right) => left.top - right.top || left.paperKey.localeCompare(right.paperKey))
      .map((node) => node.paperKey);
    for (let index = 0; index + 1 < paperKeys.length; index += 1) {
      const leftIndex = nodes.findIndex((node) => node.paperKey === paperKeys[index]);
      const rightIndex = nodes.findIndex((node) => node.paperKey === paperKeys[index + 1]);
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      if (!left || !right) continue;
      const swapped = [...nodes];
      swapped[leftIndex] = { ...left, left: right.left, top: right.top };
      swapped[rightIndex] = { ...right, left: left.left, top: left.top };
      const swappedGraph = graphFromNodes(swapped);
      const swappedQuality = evaluateAssociationLayout(input, swappedGraph);
      if (swappedQuality.weightedCrossings < quality.weightedCrossings &&
          swappedQuality.primaryEdgeCrossings <= quality.primaryEdgeCrossings &&
          swappedQuality.sameSideViolations === 0 && swappedQuality.nodeOverlaps === 0 &&
          swappedQuality.anchorObstructions === 0 && swappedQuality.overflowCount === 0) {
        nodes = swapped;
        graph = swappedGraph;
        quality = swappedQuality;
      }
    }
  }
  return graph;
}

function projectedPaperEdges(input: PageGraphInput, graph: PageGraph): PageGraphPaperEdge[] {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.paperKey, node] as const));
  return (input.paperEdges ?? []).flatMap((edge) => {
    const source = nodeByKey.get(edge.sourcePaperKey);
    const target = nodeByKey.get(edge.targetPaperKey);
    return source && target ? [{
      ...edge,
      sourceLeft: source.left,
      sourceTop: source.top,
      targetLeft: target.left,
      targetTop: target.top
    }] : [];
  });
}

function candidateIsAccepted(candidate: AssociationLayoutQuality, baseline: AssociationLayoutQuality) {
  return candidate.overflowCount === 0 && candidate.nodeOverlaps === 0 &&
    candidate.anchorObstructions === 0 && candidate.sameSideViolations === 0 &&
    candidate.primaryEdgeCrossings === 0 &&
    candidate.weightedCrossings <= baseline.weightedCrossings &&
    candidate.weightedStress <= baseline.weightedStress + 1e-9;
}

export function layoutConstrainedAssociationPageGraph(input: PageGraphInput): ConstrainedPageGraph {
  const searchDiagnostics: AssociationLayoutSearchDiagnostics = {
    initialSlotCandidateEvaluations: 0,
    repairCandidateEvaluations: 0,
    repairNodesVisited: 0,
    repairRounds: 0,
    sideVariantsEvaluated: 0,
    softVariantsEvaluated: 0
  };
  const baseline = layoutAssociationPageGraph(input);
  const baselineQuality = evaluateAssociationLayout(input, baseline);
  const preferredSides = sideAssignments(input, baseline);
  const anchorValueById = new Map([...preferredSides.keys()].map((anchorId) => [
    anchorId,
    baseline.nodes.filter((node) => node.anchorIds[0] === anchorId)
      .reduce((sum, node) => sum + node.relevance, 0)
  ] as const));
  const anchorPriority = [...preferredSides.keys()].sort((left, right) =>
    (anchorValueById.get(right) ?? 0) - (anchorValueById.get(left) ?? 0) ||
    left.localeCompare(right));
  const sideVariants = createAssociationSideVariants(preferredSides, anchorPriority);
  const candidates: Array<{
    graph: PageGraph;
    quality: AssociationLayoutQuality;
    sides: ReadonlyMap<string, AssociationSide>;
  }> = [];
  for (const sides of sideVariants) {
    searchDiagnostics.sideVariantsEvaluated += 1;
    const graph = candidateGraph(input, baseline, baselineQuality, sides, searchDiagnostics, "none");
    const quality = evaluateAssociationLayout(input, graph);
    candidates.push({ graph, quality, sides });
    if (candidateIsAccepted(quality, baselineQuality)) break;
  }
  const compareCandidate = (left: typeof candidates[number], right: typeof candidates[number]) => {
      const hardViolations = (quality: AssociationLayoutQuality) => quality.primaryEdgeCrossings +
        quality.sameSideViolations + quality.nodeOverlaps + quality.anchorObstructions + quality.overflowCount;
      return hardViolations(left.quality) - hardViolations(right.quality) ||
      left.quality.primaryEdgeCrossings - right.quality.primaryEdgeCrossings ||
      left.quality.sameSideViolations - right.quality.sameSideViolations ||
      left.quality.nodeOverlaps - right.quality.nodeOverlaps ||
      left.quality.anchorObstructions - right.quality.anchorObstructions ||
      left.quality.overflowCount - right.quality.overflowCount ||
      Number(left.quality.weightedCrossings > baselineQuality.weightedCrossings) -
        Number(right.quality.weightedCrossings > baselineQuality.weightedCrossings) ||
      Number(left.quality.weightedStress > baselineQuality.weightedStress + 1e-9) -
        Number(right.quality.weightedStress > baselineQuality.weightedStress + 1e-9) ||
      Math.max(0, left.quality.weightedCrossings - baselineQuality.weightedCrossings) -
        Math.max(0, right.quality.weightedCrossings - baselineQuality.weightedCrossings) ||
      Math.max(0, left.quality.weightedStress - baselineQuality.weightedStress) -
        Math.max(0, right.quality.weightedStress - baselineQuality.weightedStress) ||
      left.quality.weightedCrossings - right.quality.weightedCrossings ||
      left.quality.weightedStress - right.quality.weightedStress;
    };
  const distinctSideCandidates = (limit: number) => {
    const signatures = new Set<string>();
    return candidates.filter((candidate) => {
      const signature = sideVariantSignature(candidate.sides);
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      return true;
    }).slice(0, limit);
  };
  candidates.sort(compareCandidate);
  if (!candidates.some((candidate) => candidateIsAccepted(candidate.quality, baselineQuality))) {
    for (const { sides } of distinctSideCandidates(2)) {
      searchDiagnostics.softVariantsEvaluated += 1;
      const graph = candidateGraph(input, baseline, baselineQuality, sides, searchDiagnostics, "soft");
      const quality = evaluateAssociationLayout(input, graph);
      candidates.push({ graph, quality, sides });
      if (candidateIsAccepted(quality, baselineQuality)) break;
    }
    candidates.sort(compareCandidate);
  }
  const candidate = candidates[0]!.graph;
  const candidateQuality = evaluateAssociationLayout(input, candidate);
  const accepted = candidateIsAccepted(candidateQuality, baselineQuality);
  const graph = accepted ? candidate : baseline;
  return {
    ...graph,
    baselineQuality,
    candidateQuality,
    layoutSource: accepted ? "constrained" : "baseline",
    paperEdges: projectedPaperEdges(input, graph),
    quality: accepted ? candidateQuality : baselineQuality,
    searchDiagnostics
  };
}
