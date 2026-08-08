import type { ThinReadingExternalSource } from "../thin-reading/thinReading.types";

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
  sourcesByAnchor: Readonly<Record<string, readonly ThinReadingExternalSource[]>>;
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
