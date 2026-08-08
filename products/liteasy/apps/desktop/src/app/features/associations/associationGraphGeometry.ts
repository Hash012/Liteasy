export type AssociationPoint = {
  left: number;
  top: number;
};

export type AssociationSegment = {
  end: AssociationPoint;
  start: AssociationPoint;
};

export type AssociationRectangle = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type AssociationSide = "left" | "right";

export type AssociationLayoutQuality = {
  anchorObstructions: number;
  nodeOverlaps: number;
  overflowCount: number;
  primaryEdgeCrossings: number;
  sameSideViolations: number;
  weightedCrossings: number;
  weightedStress: number;
};

export type AssociationGeometryNode = AssociationPoint & {
  halfHeight: number;
  halfWidth: number;
  paperKey: string;
  relevance: number;
};

export type AssociationGeometryAnchor = AssociationPoint & {
  anchorId: string;
  obstacles: readonly AssociationRectangle[];
};

export type AssociationGeometryPaperEdge = {
  sourcePaperKey: string;
  strength: number;
  targetPaperKey: string;
};

export type AssociationGeometryPrimaryEdge = {
  anchorId: string;
  paperKey: string;
};

export type AssociationGeometryInput = {
  anchors: readonly AssociationGeometryAnchor[];
  frameHeight: number;
  frameInsetHorizontal: number;
  frameInsetVertical: number;
  frameWidth: number;
  nodeClearance: number;
  nodes: readonly AssociationGeometryNode[];
  paperEdges: readonly AssociationGeometryPaperEdge[];
  primaryEdges: readonly AssociationGeometryPrimaryEdge[];
};

const epsilon = 1e-9;
export const associationSectorAngle = 55 * Math.PI / 180;

function orientation(start: AssociationPoint, end: AssociationPoint, point: AssociationPoint) {
  return (end.left - start.left) * (point.top - start.top) -
    (end.top - start.top) * (point.left - start.left);
}

/** Returns true only for an interior-to-interior crossing. Touches and collinear overlap are clear. */
export function segmentsCross(left: AssociationSegment, right: AssociationSegment) {
  const leftStart = orientation(left.start, left.end, right.start);
  const leftEnd = orientation(left.start, left.end, right.end);
  const rightStart = orientation(right.start, right.end, left.start);
  const rightEnd = orientation(right.start, right.end, left.end);
  return ((leftStart > epsilon && leftEnd < -epsilon) || (leftStart < -epsilon && leftEnd > epsilon)) &&
    ((rightStart > epsilon && rightEnd < -epsilon) || (rightStart < -epsilon && rightEnd > epsilon));
}

export function rectanglesOverlap(left: AssociationRectangle, right: AssociationRectangle) {
  return left.left < right.right - epsilon && left.right > right.left + epsilon &&
    left.top < right.bottom - epsilon && left.bottom > right.top + epsilon;
}

export function rectanglesWithinClearance(
  left: AssociationRectangle,
  right: AssociationRectangle,
  clearance: number
) {
  const margin = Math.max(0, clearance);
  return left.left < right.right + margin - epsilon &&
    left.right > right.left - margin + epsilon &&
    left.top < right.bottom + margin - epsilon &&
    left.bottom > right.top - margin + epsilon;
}

function angularDistance(left: number, right: number) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

export function pointIsInSideSector(
  anchor: AssociationPoint,
  paper: AssociationPoint,
  side: AssociationSide
) {
  const angle = Math.atan2(paper.top - anchor.top, paper.left - anchor.left);
  return angularDistance(angle, side === "right" ? 0 : Math.PI) <= associationSectorAngle + epsilon;
}

export function evaluateSameSide(anchor: AssociationPoint, papers: readonly AssociationPoint[]): {
  side: AssociationSide | null;
  violations: number;
} {
  if (papers.length === 0) return { side: null, violations: 0 };
  const leftViolations = papers.filter((paper) => !pointIsInSideSector(anchor, paper, "left")).length;
  const rightViolations = papers.filter((paper) => !pointIsInSideSector(anchor, paper, "right")).length;
  if (leftViolations === 0) return { side: "left", violations: 0 };
  if (rightViolations === 0) return { side: "right", violations: 0 };
  return { side: null, violations: Math.min(leftViolations, rightViolations) };
}

function nodeRectangle(node: AssociationGeometryNode): AssociationRectangle {
  return {
    bottom: node.top + node.halfHeight,
    left: node.left - node.halfWidth,
    right: node.left + node.halfWidth,
    top: node.top - node.halfHeight
  };
}

type WeightedSegment = AssociationSegment & {
  primary: boolean;
  weight: number;
};

/** Exact, deterministic metrics used to decide whether a candidate is allowed to replace baseline. */
export function evaluateAssociationGeometry(input: AssociationGeometryInput): AssociationLayoutQuality {
  const nodeByKey = new Map(input.nodes.map((node) => [node.paperKey, node] as const));
  const anchorById = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const nodeRectangles = input.nodes.map(nodeRectangle);
  let overflowCount = 0;
  let nodeOverlaps = 0;
  let anchorObstructions = 0;
  let sameSideViolations = 0;

  nodeRectangles.forEach((rectangle) => {
    if (rectangle.left < input.frameInsetHorizontal - epsilon ||
        rectangle.right > input.frameWidth - input.frameInsetHorizontal + epsilon ||
        rectangle.top < input.frameInsetVertical - epsilon ||
        rectangle.bottom > input.frameHeight - input.frameInsetVertical + epsilon) {
      overflowCount += 1;
    }
  });
  for (let leftIndex = 0; leftIndex < nodeRectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodeRectangles.length; rightIndex += 1) {
      if (rectanglesWithinClearance(
        nodeRectangles[leftIndex]!,
        nodeRectangles[rightIndex]!,
        input.nodeClearance
      )) nodeOverlaps += 1;
    }
  }
  for (const rectangle of nodeRectangles) {
    for (const anchor of input.anchors) {
      if (anchor.obstacles.some((obstacle) =>
        rectanglesWithinClearance(rectangle, obstacle, input.nodeClearance))) {
        anchorObstructions += 1;
      }
    }
  }
  for (const anchor of input.anchors) {
    const papers = input.primaryEdges
      .filter((edge) => edge.anchorId === anchor.anchorId)
      .flatMap((edge) => nodeByKey.get(edge.paperKey) ?? []);
    sameSideViolations += evaluateSameSide(anchor, papers).violations;
  }

  const segments: WeightedSegment[] = [];
  let weightedStress = 0;
  for (const edge of input.primaryEdges) {
    const anchor = anchorById.get(edge.anchorId);
    const paper = nodeByKey.get(edge.paperKey);
    if (!anchor || !paper) continue;
    const distance = Math.hypot(paper.left - anchor.left, paper.top - anchor.top);
    const ideal = 158 + (1 - Math.min(Math.max(paper.relevance, 0), 1)) * 152;
    weightedStress += 3 * ((distance - ideal) / ideal) ** 2;
    segments.push({ start: anchor, end: paper, primary: true, weight: 3 });
  }
  for (const edge of input.paperEdges) {
    const source = nodeByKey.get(edge.sourcePaperKey);
    const target = nodeByKey.get(edge.targetPaperKey);
    if (!source || !target) continue;
    const strength = Math.min(Math.max(edge.strength, 0), 1);
    const distance = Math.hypot(target.left - source.left, target.top - source.top);
    const ideal = 108 + (1 - strength) * 172;
    weightedStress += ((distance - ideal) / ideal) ** 2;
    segments.push({ start: source, end: target, primary: false, weight: 1 });
  }

  let primaryEdgeCrossings = 0;
  let weightedCrossings = 0;
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]!;
      const right = segments[rightIndex]!;
      if (!segmentsCross(left, right)) continue;
      weightedCrossings += left.weight * right.weight;
      if (left.primary && right.primary) primaryEdgeCrossings += 1;
    }
  }

  return {
    anchorObstructions,
    nodeOverlaps,
    overflowCount,
    primaryEdgeCrossings,
    sameSideViolations,
    weightedCrossings,
    weightedStress
  };
}
