import { Button } from "@fluentui/react-components";
import { AddRegular, DismissRegular, OpenRegular } from "@fluentui/react-icons";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

import type {
  ThinReadingAnchorQuality,
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../thin-reading/thinReading.types";
import { externalPdfDragMimeType, toExternalPdfDragPayload } from "../library/externalPdfDownload";
import {
  layoutConstrainedAssociationPageGraph,
  pageGraphPaperKey,
  pageGraphNodeWidth,
  type AnchorRect,
  type PageGraphNode
} from "./associationGraphLayout";
import { createAssociationInkPaths, type AssociationInkPaths } from "./associationHandDrawnPath";
import { projectAssociationPageGraph } from "./associationGraphProjection";
import {
  associationAnchorEdgePresentation,
  associationConfidenceLabel,
  associationPaperEdgePresentation,
  associationRelationLabel,
  associationSourceMetadata,
  associationSourceReason,
  type AssociationEdgePresentation
} from "./associationSourcePresentation";

/**
 * The page-level association graph, over whatever text carries the anchors.
 *
 * The text stays where it is and dims; the anchors stay where they are and light up; the related
 * work is drawn in the space above it, each paper at a distance that means how related it is.
 * Nothing here moves the reader's place in the document, which is the whole reason this is a layer
 * over the text rather than a panel beside it.
 *
 * It is deliberately host-agnostic: it takes measured anchor rectangles in the coordinates of
 * whatever container it is mounted in — a thin-reading article, a PDF document frame — and knows
 * nothing else about them. The reading card, which must stay centred in the window no matter how
 * tall that container is, is a separate viewport-level host: `AssociationReadingOverlay` below.
 */

export type PageGraphAnchorView = {
  anchorId: string;
  /** Free-form kind, used only to colour the mark. Each host names its own kinds. */
  kind: string;
  label: string;
  quality?: ThinReadingAnchorQuality;
  /** Every measured rectangle of the anchor's text, so the highlight follows a wrapped line. */
  rects: readonly AnchorRect[];
};

type AssociationGraphLayerProps = {
  activeSourceId: string | null;
  anchors: readonly PageGraphAnchorView[];
  documentHeight: number;
  focusedAnchorId: string | null;
  frameWidth: number;
  onClose: () => void;
  onFocusAnchor: (anchorId: string | null) => void;
  onSelectSource: (sourceId: string) => void;
  paperEdges?: readonly ThinReadingRecommendationPaperEdge[];
  sourcesByAnchor: Readonly<Record<string, readonly ThinReadingExternalSource[]>>;
};

type HoverState = {
  left: number;
  node: PageGraphNode;
  top: number;
};

const hoverCardWidth = 248;

type RenderedAssociationEdge = {
  accessibleLabel?: string;
  active: boolean;
  className: string;
  dimmed: boolean;
  edgeId: string;
  markerEnd?: string;
  paths: AssociationInkPaths;
  style: CSSProperties;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function associationEdgeStyle(distance: number, strength: number) {
  const proximity = 1 - clamp((distance - 72) / 520, 0, 1);
  const opacity = 0.18 + proximity * 0.36 + clamp(strength, 0, 1) * 0.16;
  return {
    "--edge-opacity": opacity,
    "--edge-strength": clamp(strength, 0, 1),
    "--edge-width": `${0.92 + clamp(strength, 0, 1) * 0.48}px`,
    "--edge-wash-opacity": opacity * 0.26
  } as CSSProperties;
}

function anchorExactPath(
  anchorLeft: number,
  anchorTop: number,
  nodeLeft: number,
  nodeTop: number
) {
  const curveX = anchorLeft + (nodeLeft - anchorLeft) * 0.52;
  const curveY = anchorTop + (nodeTop - anchorTop) * 0.48 + (nodeTop < anchorTop ? -10 : 10);
  return `M ${anchorLeft} ${anchorTop} Q ${curveX} ${curveY} ${nodeLeft} ${nodeTop}`;
}

function paperExactPath(sourceLeft: number, sourceTop: number, targetLeft: number, targetTop: number) {
  return `M ${sourceLeft} ${sourceTop} Q ${(sourceLeft + targetLeft) / 2} ${(sourceTop + targetTop) / 2} ${targetLeft} ${targetTop}`;
}

function edgeClassName(
  edge: RenderedAssociationEdge,
  stroke: "echo" | "hit" | "ink" | "wash",
  effectiveActiveEdgeId: string | null
) {
  return `association-edge ${edge.className} is-${stroke}${
    edge.active || effectiveActiveEdgeId === edge.edgeId ? " is-active" : ""
  }${
    edge.dimmed ? " is-dimmed" : ""
  }`;
}

/**
 * How wide the anchor's chip will be, so the layout can keep nodes off it. Measured in the same
 * 12px/700 face the chip uses: full-width glyphs take about 12.5px, Latin about 7, plus padding.
 * The cap matches the chip's `max-width` in app.css.
 */
function estimateChipWidth(label: string, frameWidth: number) {
  let width = 26;
  for (const character of label) {
    width += /[⺀-鿿＀-￯]/u.test(character) ? 12.5 : 7;
  }
  return Math.min(width, 320, Math.max(120, frameWidth * 0.46));
}

/** Beside the node, flipped to the other side when the preferred one would leave the frame. */
function hoverCardCentre(nodeLeft: number, frameWidth: number) {
  const offset = pageGraphNodeWidth / 2 + 12 + hoverCardWidth / 2;
  const right = nodeLeft + offset;
  const fits = right + hoverCardWidth / 2 <= frameWidth - 8;
  const centre = fits ? right : nodeLeft - offset;
  return Math.min(
    Math.max(centre, hoverCardWidth / 2 + 8),
    Math.max(hoverCardWidth / 2 + 8, frameWidth - hoverCardWidth / 2 - 8)
  );
}

export function AssociationGraphLayer({
  activeSourceId,
  anchors,
  documentHeight,
  focusedAnchorId,
  frameWidth,
  onClose,
  onFocusAnchor,
  onSelectSource,
  paperEdges = [],
  sourcesByAnchor
}: AssociationGraphLayerProps) {
  const [focusedEdgeId, setFocusedEdgeId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [rovingEdgeId, setRovingEdgeId] = useState<string | null>(null);

  const projection = useMemo(() => projectAssociationPageGraph({
    anchors,
    paperEdges,
    sourcesByAnchor
  }), [anchors, paperEdges, sourcesByAnchor]);
  const projectedNodeByPaperKey = useMemo(
    () => new Map(projection.paperNodes.map((node) => [node.paperKey, node] as const)),
    [projection.paperNodes]
  );
  const primarySourcesByAnchor = useMemo(() => {
    const result: Record<string, ThinReadingExternalSource[]> = {};
    for (const node of projection.paperNodes) {
      (result[node.primaryAnchorId] ??= []).push(node.source);
    }
    return result;
  }, [projection.paperNodes]);
  const paperKeyBySource = useMemo(
    () => new Map(projection.paperNodes.map((node) => [node.source, node.paperKey] as const)),
    [projection.paperNodes]
  );
  const multiAnchorPaperKeys = useMemo(
    () => new Set(projection.paperNodes.filter((node) => node.anchorIds.length > 1)
      .map((node) => node.paperKey)),
    [projection.paperNodes]
  );

  const graph = useMemo(() => layoutConstrainedAssociationPageGraph({
    anchors: anchors
      .filter((anchor) => anchor.rects.length > 0)
      .map((anchor) => ({
        anchorId: anchor.anchorId,
        labelWidth: estimateChipWidth(anchor.label, frameWidth),
        rect: anchor.rects[0]
      })),
    documentHeight,
    frameWidth,
    multiAnchorPaperKeys,
    paperKeyBySource,
    paperEdges: projection.paperEdges,
    sourcesByAnchor: primarySourcesByAnchor
  }), [anchors, documentHeight, frameWidth, multiAnchorPaperKeys, paperKeyBySource,
    primarySourcesByAnchor, projection.paperEdges]);

  const dimmed = (anchorIds: readonly string[]) =>
    Boolean(focusedAnchorId) && !anchorIds.includes(focusedAnchorId!);
  const activeSource = activeSourceId
    ? Object.values(sourcesByAnchor).flat().find((source) => source.id === activeSourceId)
    : undefined;
  const activePaperKey = activeSource
    ? projection.paperNodes.find((node) => node.source.id === activeSource.id)?.paperKey ??
      pageGraphPaperKey(activeSource)
    : null;
  const anchorById = new Map(anchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const secondaryEdges = graph.nodes.flatMap((node) => {
    const projectedNode = projectedNodeByPaperKey.get(node.paperKey);
    if (!projectedNode) return [];
    const paperFocused = activePaperKey === node.paperKey || hover?.node.paperKey === node.paperKey;
    return projectedNode.secondaryAnchorIds.flatMap((anchorId) => {
      if (!paperFocused && focusedAnchorId !== anchorId) return [];
      const anchor = anchorById.get(anchorId);
      const rect = anchor?.rects[0];
      if (!anchor || !rect) return [];
      return [{
        anchorId,
        anchorLabel: anchor.label,
        anchorLeft: rect.left + rect.width / 2,
        anchorTop: rect.top + rect.height / 2,
        node,
        paperKey: projectedNode.paperKey
      }];
    });
  });
  const nodeByPaperKey = new Map(graph.nodes.map((node) => [node.paperKey, node] as const));
  const primaryInkEdges: RenderedAssociationEdge[] = graph.edges.flatMap((edge) => {
    const node = nodeByPaperKey.get(edge.paperKey);
    const anchor = anchorById.get(edge.anchorId);
    if (!node || !anchor) return [];
    const edgeId = `primary:${edge.anchorId}:${edge.paperKey}`;
    const exactPath = anchorExactPath(edge.anchorLeft, edge.anchorTop, edge.nodeLeft, edge.nodeTop);
    const distance = Math.hypot(edge.nodeLeft - edge.anchorLeft, edge.nodeTop - edge.anchorTop);
    const presentation = associationAnchorEdgePresentation(node.source.confidenceBasis);
    return [{
      accessibleLabel: `${anchor.label} 与 ${node.source.title}：${presentation.label}`,
      active: activePaperKey === edge.paperKey || hover?.node.paperKey === edge.paperKey,
      className: `is-primary ${presentation.className}`,
      dimmed: dimmed([edge.anchorId]),
      edgeId,
      paths: createAssociationInkPaths({ edgeId, exactPath }),
      style: associationEdgeStyle(distance, edge.confidence)
    }];
  });
  const paperInkEdges: RenderedAssociationEdge[] = graph.paperEdges.flatMap((edge) => {
    const source = nodeByPaperKey.get(edge.sourcePaperKey);
    const target = nodeByPaperKey.get(edge.targetPaperKey);
    if (!source || !target) return [];
    const edgeId = `paper:${edge.kind}:${edge.sourcePaperKey}:${edge.targetPaperKey}`;
    const exactPath = paperExactPath(edge.sourceLeft, edge.sourceTop, edge.targetLeft, edge.targetTop);
    const presentation = associationPaperEdgePresentation(edge.kind);
    const endpointFocused = activePaperKey === edge.sourcePaperKey || activePaperKey === edge.targetPaperKey ||
      hover?.node.paperKey === edge.sourcePaperKey || hover?.node.paperKey === edge.targetPaperKey;
    const endpointAnchorIds = [...source.anchorIds, ...target.anchorIds];
    return [{
      accessibleLabel: edge.directed
        ? `${presentation.label}：${source.source.title} 指向 ${target.source.title}`
        : `${presentation.label}：${source.source.title} 与 ${target.source.title}`,
      active: endpointFocused,
      className: `is-paper-relation ${presentation.className}`,
      dimmed: dimmed(endpointAnchorIds),
      edgeId,
      markerEnd: edge.directed ? "url(#association-direct-citation-end)" : undefined,
      paths: createAssociationInkPaths({ edgeId, exactPath }),
      style: associationEdgeStyle(
        Math.hypot(edge.targetLeft - edge.sourceLeft, edge.targetTop - edge.sourceTop),
        edge.strength
      )
    }];
  });
  const secondaryInkEdges: RenderedAssociationEdge[] = secondaryEdges.map((edge) => {
    const edgeId = `secondary:${edge.anchorId}:${edge.paperKey}`;
    const exactPath = anchorExactPath(
      edge.anchorLeft,
      edge.anchorTop,
      edge.node.left,
      edge.node.top
    );
    const presentation = associationAnchorEdgePresentation(edge.node.source.confidenceBasis);
    return {
      accessibleLabel: `次级关联：${edge.paperKey} 与 ${edge.anchorLabel}`,
      active: true,
      className: `is-secondary ${presentation.className}`,
      dimmed: false,
      edgeId,
      paths: createAssociationInkPaths({ edgeId, exactPath }),
      style: associationEdgeStyle(
        Math.hypot(edge.node.left - edge.anchorLeft, edge.node.top - edge.anchorTop),
        edge.node.confidence
      )
    };
  });
  const legendItems = [...new Map<
    string,
    AssociationEdgePresentation
  >([
    ...graph.nodes.map((node) => associationAnchorEdgePresentation(node.source.confidenceBasis)),
    ...graph.paperEdges.map((edge) => associationPaperEdgePresentation(edge.kind))
  ].map((presentation) => [presentation.label, presentation] as const)).values()];
  const allInkEdges = [...paperInkEdges, ...primaryInkEdges, ...secondaryInkEdges];
  const edgeOrder = allInkEdges.map((edge) => edge.edgeId);
  const edgeOrderKey = JSON.stringify(edgeOrder);
  const edgeIds = new Set(edgeOrder);
  const validFocusedEdgeId = focusedEdgeId && edgeIds.has(focusedEdgeId) ? focusedEdgeId : null;
  const validHoveredEdgeId = hoveredEdgeId && edgeIds.has(hoveredEdgeId) ? hoveredEdgeId : null;
  const effectiveActiveEdgeId = validHoveredEdgeId ?? validFocusedEdgeId;
  const effectiveRovingEdgeId = rovingEdgeId && edgeIds.has(rovingEdgeId)
    ? rovingEdgeId
    : edgeOrder[0] ?? null;

  useEffect(() => {
    const currentIds = new Set(edgeOrder);
    setFocusedEdgeId((current) => current && !currentIds.has(current) ? null : current);
    setHoveredEdgeId((current) => current && !currentIds.has(current) ? null : current);
    setRovingEdgeId((current) => current && currentIds.has(current) ? current : edgeOrder[0] ?? null);
  }, [edgeOrderKey]);

  const moveRovingEdgeFocus = (
    event: ReactKeyboardEvent<SVGPathElement>,
    currentIndex: number
  ) => {
    if (allInkEdges.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % allInkEdges.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + allInkEdges.length) % allInkEdges.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = allInkEdges.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextEdge = allInkEdges[nextIndex];
    if (!nextEdge) return;
    setRovingEdgeId(nextEdge.edgeId);
    event.currentTarget.ownerSVGElement
      ?.querySelector<SVGPathElement>(`[data-edge-index="${nextIndex}"]`)
      ?.focus();
  };

  return (
    <section
      aria-label="页级关联图"
      className="association-layer"
      data-anchor-obstructions={graph.quality.anchorObstructions}
      data-baseline-stress={graph.baselineQuality.weightedStress}
      data-candidate-anchor-obstructions={graph.candidateQuality.anchorObstructions}
      data-candidate-crossings={graph.candidateQuality.primaryEdgeCrossings}
      data-candidate-node-overlaps={graph.candidateQuality.nodeOverlaps}
      data-candidate-overflow={graph.candidateQuality.overflowCount}
      data-candidate-same-side={graph.candidateQuality.sameSideViolations}
      data-candidate-stress={graph.candidateQuality.weightedStress}
      data-layout-source={graph.layoutSource}
      data-node-overlaps={graph.quality.nodeOverlaps}
      data-overflow-count={graph.quality.overflowCount}
      data-primary-edge-crossings={graph.quality.primaryEdgeCrossings}
      data-repair-candidates={graph.searchDiagnostics.repairCandidateEvaluations}
      data-repair-nodes={graph.searchDiagnostics.repairNodesVisited}
      data-repair-rounds={graph.searchDiagnostics.repairRounds}
      data-same-side-violations={graph.quality.sameSideViolations}
      data-side-variants={graph.searchDiagnostics.sideVariantsEvaluated}
      data-soft-variants={graph.searchDiagnostics.softVariantsEvaluated}
      style={{ height: documentHeight }}
    >
      <div
        className="association-layer__scrim"
        data-association-blank="true"
        onClick={(event) => {
          if ((event.target as HTMLElement).dataset.associationBlank === "true") onClose();
        }}
      />

      <svg
        aria-label="页级关联边"
        className="association-layer__edges"
        height={documentHeight}
        viewBox={`0 0 ${Math.max(1, frameWidth)} ${Math.max(1, documentHeight)}`}
        width={frameWidth}
        role="group"
      >
        <defs>
          <marker
            id="association-direct-citation-end"
            markerHeight="6"
            markerUnits="strokeWidth"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
            viewBox="0 0 6 6"
          >
            <path className="association-edge__direction" d="M 0 0 L 6 3 L 0 6 Z" />
          </marker>
        </defs>

        {paperInkEdges.map((edge) => (
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "wash", effectiveActiveEdgeId)}
            d={edge.paths.washPath}
            data-edge-layer="paper-wash"
            key={`${edge.edgeId}:wash`}
            style={edge.style}
          />
        ))}
        {paperInkEdges.flatMap((edge) => [
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "ink", effectiveActiveEdgeId)}
            d={edge.paths.inkPath}
            data-edge-layer="paper-ink"
            key={`${edge.edgeId}:ink`}
            markerEnd={edge.markerEnd}
            style={edge.style}
          />,
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "echo", effectiveActiveEdgeId)}
            d={edge.paths.echoPath}
            data-edge-layer="paper-echo"
            key={`${edge.edgeId}:echo`}
            style={edge.style}
          />
        ])}
        {primaryInkEdges.map((edge) => (
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "wash", effectiveActiveEdgeId)}
            d={edge.paths.washPath}
            data-edge-layer="primary-wash"
            key={`${edge.edgeId}:wash`}
            style={edge.style}
          />
        ))}
        {primaryInkEdges.flatMap((edge) => [
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "ink", effectiveActiveEdgeId)}
            d={edge.paths.inkPath}
            data-edge-layer="primary-ink"
            key={`${edge.edgeId}:ink`}
            style={edge.style}
          />,
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "echo", effectiveActiveEdgeId)}
            d={edge.paths.echoPath}
            data-edge-layer="primary-echo"
            key={`${edge.edgeId}:echo`}
            style={edge.style}
          />
        ])}
        {secondaryInkEdges.flatMap((edge) => [
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "wash", effectiveActiveEdgeId)}
            d={edge.paths.washPath}
            data-edge-layer="secondary-wash"
            key={`${edge.edgeId}:wash`}
            style={edge.style}
          />,
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "ink", effectiveActiveEdgeId)}
            d={edge.paths.inkPath}
            data-edge-layer="secondary-ink"
            key={`${edge.edgeId}:ink`}
            style={edge.style}
          />,
          <path
            aria-hidden="true"
            className={edgeClassName(edge, "echo", effectiveActiveEdgeId)}
            d={edge.paths.echoPath}
            data-edge-layer="secondary-echo"
            key={`${edge.edgeId}:echo`}
            style={edge.style}
          />
        ])}
        {allInkEdges.map((edge, edgeIndex) => (
          <path
            aria-label={edge.accessibleLabel}
            className={edgeClassName(edge, "hit", effectiveActiveEdgeId)}
            d={edge.paths.hitPath}
            data-edge-id={edge.edgeId}
            data-edge-index={edgeIndex}
            data-edge-layer="edge-hit"
            key={`${edge.edgeId}:hit`}
            onBlur={() => setFocusedEdgeId((current) => current === edge.edgeId ? null : current)}
            onFocus={() => {
              setFocusedEdgeId(edge.edgeId);
              setRovingEdgeId(edge.edgeId);
            }}
            onKeyDown={(event) => moveRovingEdgeFocus(event, edgeIndex)}
            onMouseEnter={() => setHoveredEdgeId(edge.edgeId)}
            onMouseLeave={() => setHoveredEdgeId((current) => current === edge.edgeId ? null : current)}
            role="img"
            tabIndex={effectiveRovingEdgeId === edge.edgeId ? 0 : -1}
          />
        ))}
      </svg>

      {!activeSourceId && legendItems.length > 0 ? (
        <div aria-label="当前关系图例" className="association-legend">
          {legendItems.map((presentation) => (
            <span key={presentation.label}>
              <i className={`association-legend__line ${presentation.className}`} />
              {presentation.label}
            </span>
          ))}
        </div>
      ) : null}

      {anchors.map((anchor) => {
        const isDimmed = dimmed([anchor.anchorId]);
        const first = anchor.rects[0];
        if (!first) return null;
        const hiddenCount = graph.hiddenCountByAnchor[anchor.anchorId] ?? 0;
        return (
          <div
            className={`association-anchor${isDimmed ? " is-dimmed" : ""}${
              focusedAnchorId === anchor.anchorId ? " is-focused" : ""
            }`}
            key={anchor.anchorId}
          >
            {/* Continuation lines only. The first line is covered by the chip, which carries the
                anchor's own words — the dimmed page cannot supply legible glyphs of its own. */}
            {anchor.rects.slice(1).map((rect, index) => (
              <span
                aria-hidden="true"
                className={`association-anchor__mark is-${anchor.kind}`}
                key={index}
                style={{
                  height: rect.height,
                  left: rect.left,
                  top: rect.top,
                  width: rect.width
                }}
              />
            ))}
            <button
              aria-label={`锚点：${anchor.label}${
                focusedAnchorId === anchor.anchorId ? "，已聚焦，再次点击取消" : "，点击只看它的关联"
              }`}
              aria-pressed={focusedAnchorId === anchor.anchorId}
              className="association-anchor__chip"
              onClick={() => onFocusAnchor(focusedAnchorId === anchor.anchorId ? null : anchor.anchorId)}
              // Wide enough to cover the dim text it stands for, so the anchor reads as staying
              // exactly where it was rather than as a second copy floating beside it.
              style={{ left: first.left, minWidth: first.width + 12, top: first.top + first.height / 2 }}
              type="button"
            >
              {anchor.label}
              {hiddenCount > 0 ? <em>+{hiddenCount}</em> : null}
            </button>
          </div>
        );
      })}

      {graph.nodes.map((node) => {
        const source = node.source;
        const sourcePresentation = associationAnchorEdgePresentation(source.confidenceBasis);
        const anchorIds = projectedNodeByPaperKey.get(node.paperKey)?.anchorIds ?? node.anchorIds;
        const crossing = anchorIds.length > 1;
        const dragPayload = toExternalPdfDragPayload(source);
        return (
          <button
            aria-label={`${source.title}，${associationRelationLabel(source.relation)}，${
              associationConfidenceLabel(source.confidenceBasis)
            }${crossing ? `，${anchorIds.length} 个锚点交叉` : ""}`}
            className={`association-node ${sourcePresentation.className}${node.isDot ? " is-dot" : ""}${
              crossing ? " is-crossing" : ""
            }${dimmed(anchorIds) ? " is-dimmed" : ""}${
              activeSourceId === source.id ? " is-active" : ""
            }`}
            /* The provenance of the link, carried as a colour bar so the legend has something to
               name. Never as distance — that is relevance and nothing else. */
            data-basis={source.confidenceBasis ?? "algorithmic_retrieval"}
            draggable
            key={node.paperKey}
            onBlur={() => setHover(null)}
            onClick={() => onSelectSource(source.id)}
            onDragStart={(event) => {
              setHover(null);
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(externalPdfDragMimeType, JSON.stringify(dragPayload));
            }}
            onFocus={() => setHover({ left: node.left, node, top: node.top })}
            onMouseEnter={() => setHover({ left: node.left, node, top: node.top })}
            onMouseLeave={() => setHover(null)}
            style={{
              "--node-border-opacity": 0.18 + node.relevance * 0.28,
              "--node-left": `${node.left}px`,
              "--node-top": `${node.top}px`
            } as CSSProperties}
            type="button"
          >
            {crossing ? <em className="association-node__crossing">{anchorIds.length} 个锚点交叉</em> : null}
            <small>{source.year ?? ""}</small>
            <strong>{source.title}</strong>
          </button>
        );
      })}

      {/* Hover says why the link exists. The resting state carries no text at all, and a native
          tooltip would be both unstyleable and too slow to read a reason from. */}
      {hover ? (
        <div
          className="association-hover-card"
          style={{ left: hoverCardCentre(hover.left, frameWidth), top: hover.top }}
        >
          <strong>{associationRelationLabel(hover.node.source.relation)}</strong>
          {/* For a cited work the reason *is* the relation, and saying it twice reads as a bug.
              The line is spent on who wrote it instead. */}
          <span>
            {associationSourceReason(hover.node.source) === associationRelationLabel(hover.node.source.relation)
              ? associationSourceMetadata(hover.node.source)
              : associationSourceReason(hover.node.source)}
          </span>
          <small>{associationConfidenceLabel(hover.node.source.confidenceBasis)}</small>
        </div>
      ) : null}
    </section>
  );
}

type AssociationReadingOverlayProps = {
  activeSource: ThinReadingExternalSource | null;
  anchorCount: number;
  /**
   * Where the overlay is pinned. `container` when the host already gives it a viewport-sized box
   * (the PDF stage); `viewport` when the host is as tall as its content, which would otherwise put
   * the reading card somewhere down the article where nobody can see it.
   */
  anchored?: "container" | "viewport";
  error?: string;
  loading?: boolean;
  /** Absent when the host cannot save papers; the action is then hidden, never a dead button. */
  onAddToLibrary?: (source: ThinReadingExternalSource) => void;
  onClose: () => void;
  onOpenFullText?: (source: ThinReadingExternalSource) => void;
  onSelectSource: (sourceId: string) => void;
  /** Copy for the empty states, which differ between a PDF page and a generated article. */
  emptyAnchorsMessage?: string;
  emptySourcesMessage?: string;
  sourceCount: number;
  warning?: string;
};

/**
 * Everything that must stay put while the document scrolls: the legend, the state of the
 * retrieval, and the reading card. Positioned against the viewport rather than the document,
 * because a card centred in a forty-page document is a card nobody can see.
 */
export function AssociationReadingOverlay({
  activeSource,
  anchorCount,
  anchored = "container",
  emptyAnchorsMessage = "当前页没有识别出锚点，翻到有锚点的页可以看到关联。",
  emptySourcesMessage = "这一页的锚点还没有可验证的关联文献。",
  error,
  loading = false,
  onAddToLibrary,
  onClose,
  onOpenFullText,
  onSelectSource,
  sourceCount,
  warning
}: AssociationReadingOverlayProps) {
  return (
    <div
      aria-label="页级关联图状态"
      className={`association-overlay${anchored === "viewport" ? " is-fixed" : ""}`}
    >
      {loading ? (
        <div className="association-message" role="status">正在整理关联文献…</div>
      ) : error ? (
        <div className="association-message is-error" role="alert">{error}</div>
      ) : warning ? (
        <div className="association-message" role="status">{warning}</div>
      ) : anchorCount === 0 ? (
        <div className="association-message" role="note">{emptyAnchorsMessage}</div>
      ) : sourceCount === 0 ? (
        <div className="association-message" role="note">{emptySourcesMessage}</div>
      ) : null}

      {activeSource ? (
        <>
          <div className="association-reading-backdrop" onClick={onClose} />
          <article aria-label={`关联论文：${activeSource.title}`} className="association-reading-card">
            <button
              aria-label="返回关联图"
              autoFocus
              className="association-reading-card__dismiss"
              onClick={() => onSelectSource("")}
              title="返回关联图"
              type="button"
            >
              <DismissRegular />
            </button>
            <small className="association-reading-card__basis">
              {associationConfidenceLabel(activeSource.confidenceBasis)}
            </small>
            <h3>{activeSource.title}</h3>
            <p className="association-reading-card__meta">{associationSourceMetadata(activeSource)}</p>
            <p>{associationSourceReason(activeSource)}</p>
            {activeSource.abstract ? (
              <p className="association-reading-card__abstract">{activeSource.abstract}</p>
            ) : null}
            <div className="association-reading-card__actions">
              {activeSource.fullTextUrl && onOpenFullText ? (
                <Button
                  appearance="primary"
                  icon={<OpenRegular />}
                  onClick={() => onOpenFullText(activeSource)}
                  size="small"
                >
                  阅读全文
                </Button>
              ) : null}
              {onAddToLibrary ? (
                <Button
                  appearance={activeSource.fullTextUrl ? "secondary" : "primary"}
                  icon={<AddRegular />}
                  onClick={() => onAddToLibrary(activeSource)}
                  size="small"
                >
                  {activeSource.fullTextUrl ? "加入文献库" : "保存条目"}
                </Button>
              ) : null}
              {!activeSource.fullTextUrl ? (
                <a href={activeSource.url} rel="noreferrer" target="_blank">
                  <OpenRegular aria-hidden="true" />查看来源记录
                </a>
              ) : null}
            </div>
            {!activeSource.fullTextUrl ? (
              <small>未发现开放全文，将仅保存可追溯的元数据条目。</small>
            ) : null}
          </article>
        </>
      ) : null}
    </div>
  );
}
