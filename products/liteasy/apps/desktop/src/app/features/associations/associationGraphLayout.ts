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
  layoutSource: "baseline" | "constrained";
  paperEdges: readonly PageGraphPaperEdge[];
  quality: AssociationLayoutQuality;
};

/**
 * Kept in step with `--association-node-width/height` in app.css. The height is the *tallest* a
 * card gets — crossing badge, year, and a two-line title — because a layout that reserves the
 * average height overlaps exactly on the cards that carry the most.
 */
export const pageGraphNodeWidth = 152;
export const pageGraphNodeHeight = 76;
export const pageGraphDotSize = 14;
export const maximumPageGraphSources = 8;

const nodeGap = 10;
const frameInsetHorizontal = 10;
const frameInsetVertical = 8;

const nearRadius = 158;
const radiusSpread = 152;
const dotThreshold = 0.62;
const relaxationStep = 26;
const relaxationRounds = 24;

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

/** Half the footprint a node occupies: a collapsed dot claims far less room than a title card. */
function nodeBox(isDot: boolean, left: number, top: number): OccupiedBox {
  const half = isDot ? pageGraphDotSize / 2 : undefined;
  return {
    halfHeight: half ?? pageGraphNodeHeight / 2,
    halfWidth: half ?? pageGraphNodeWidth / 2,
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
      placements.push({
        anchorId: anchor.anchorId,
        angle,
        confidence: clamp(source.confidence ?? 0.3, 0, 1),
        isDot: normalizedDistance > dotThreshold,
        left: centre.left + Math.cos(angle) * radius,
        paperKey: paperKeyBySource?.get(source) ?? pageGraphPaperKey(source),
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

function projectToSector(
  node: ForceNode,
  anchor: ForceNode,
  side: AssociationSide,
  input: PageGraphInput,
  graphNode: PageGraphNode
) {
  const halfWidth = graphNode.isDot ? pageGraphDotSize / 2 : pageGraphNodeWidth / 2;
  const halfHeight = graphNode.isDot ? pageGraphDotSize / 2 : pageGraphNodeHeight / 2;
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

function candidateGraph(input: PageGraphInput, baseline: PageGraph): PageGraph {
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const sideByAnchor = sideAssignments(input, baseline);
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
    .force("collision", forceCollide<ForceNode>().radius((node) => {
      if (node.isAnchor) return 30;
      const graphNode = baseline.nodes.find((entry) => entry.paperKey === node.paperKey)!;
      return graphNode.isDot ? pageGraphDotSize / 2 + 5 : pageGraphNodeHeight / 2 + 5;
    }).iterations(2))
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
      if (anchor && node && side) projectToSector(node, anchor, side, input, graphNode);
    }
  }

  // Circular collision forces are intentionally only a first pass. Cards are rectangles, so each
  // one snaps to the nearest exact legal polar slot while retaining the force result as a tie-break.
  const collisionOrder = [...baseline.nodes].sort((left, right) =>
    right.relevance - left.relevance || left.paperKey.localeCompare(right.paperKey));
  const rectangleAt = (graphNode: PageGraphNode, left: number, top: number) => {
    const halfWidth = graphNode.isDot ? pageGraphDotSize / 2 : pageGraphNodeWidth / 2;
    const halfHeight = graphNode.isDot ? pageGraphDotSize / 2 : pageGraphNodeHeight / 2;
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
  const relativeAngles = [0, -10, 10, -20, 20, -30, 30, -40, 40, -50, 50, -55, 55]
    .map((degrees) => degrees * Math.PI / 180);
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
    const candidates = relativeAngles.flatMap((relativeAngle) =>
      Array.from({ length: 31 }, (_, radiusIndex) => {
        const radius = ideal + radiusIndex * 8;
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
        return {
          forceDistance,
          left,
          radialStress,
          rectangle,
          score: radialStress * 3 + relationStress + forceDistance * 1e-6,
          top
        };
      })).filter((candidate) => candidate.rectangle.left >= frameInsetHorizontal &&
        candidate.rectangle.right <= input.frameWidth - frameInsetHorizontal &&
        candidate.rectangle.top >= frameInsetVertical &&
        candidate.rectangle.bottom <= input.documentHeight - frameInsetVertical &&
        !placedRectangles.some((rectangle) => intersects(candidate.rectangle, rectangle)))
      .sort((left, right) => left.score - right.score || left.radialStress - right.radialStress ||
        left.forceDistance - right.forceDistance || left.top - right.top || left.left - right.left);
    const selected = candidates[0];
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
  const baseline = layoutAssociationPageGraph(input);
  const baselineQuality = evaluateAssociationLayout(input, baseline);
  const candidate = candidateGraph(input, baseline);
  const candidateQuality = evaluateAssociationLayout(input, candidate);
  const accepted = candidateIsAccepted(candidateQuality, baselineQuality);
  const graph = accepted ? candidate : baseline;
  return {
    ...graph,
    layoutSource: accepted ? "constrained" : "baseline",
    paperEdges: projectedPaperEdges(input, graph),
    quality: accepted ? candidateQuality : baselineQuality
  };
}
