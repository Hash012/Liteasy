import { Button } from "@fluentui/react-components";
import { AddRegular, DismissRegular, OpenRegular } from "@fluentui/react-icons";
import { useMemo, useState, type CSSProperties } from "react";

import type {
  ThinReadingAnchorQuality,
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../thin-reading/thinReading.types";
import { externalPdfDragMimeType, toExternalPdfDragPayload } from "../library/externalPdfDownload";
import {
  layoutAssociationPageGraph,
  pageGraphPaperKey,
  pageGraphNodeWidth,
  type AnchorRect,
  type PageGraphNode
} from "./associationGraphLayout";
import { projectAssociationPageGraph } from "./associationGraphProjection";
import {
  associationConfidenceLabel,
  associationRelationLabel,
  associationSourceMetadata,
  associationSourceReason
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
  const [hover, setHover] = useState<HoverState | null>(null);

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

  const graph = useMemo(() => layoutAssociationPageGraph({
    anchors: anchors
      .filter((anchor) => anchor.rects.length > 0)
      .map((anchor) => ({
        anchorId: anchor.anchorId,
        labelWidth: estimateChipWidth(anchor.label, frameWidth),
        rect: anchor.rects[0]
      })),
    documentHeight,
    frameWidth,
    sourcesByAnchor: primarySourcesByAnchor
  }), [anchors, documentHeight, frameWidth, primarySourcesByAnchor]);

  const dimmed = (anchorIds: readonly string[]) =>
    Boolean(focusedAnchorId) && !anchorIds.includes(focusedAnchorId!);
  const activeSource = activeSourceId
    ? Object.values(sourcesByAnchor).flat().find((source) => source.id === activeSourceId)
    : undefined;
  const activePaperKey = activeSource ? pageGraphPaperKey(activeSource) : null;
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

  return (
    <section
      aria-label="页级关联图"
      className="association-layer"
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
        {graph.edges.map((edge) => {
          const crossing = (projectedNodeByPaperKey.get(edge.paperKey)?.anchorIds.length ?? 0) > 1;
          const curveX = edge.anchorLeft + (edge.nodeLeft - edge.anchorLeft) * 0.52;
          const curveY = edge.anchorTop + (edge.nodeTop - edge.anchorTop) * 0.48 +
            (edge.nodeTop < edge.anchorTop ? -10 : 10);
          return (
            <path
              className={`association-edge${crossing ? " is-crossing" : ""}${
                dimmed([edge.anchorId]) ? " is-dimmed" : ""
              }${activePaperKey === edge.paperKey || hover?.node.paperKey === edge.paperKey ? " is-active" : ""}`}
              d={`M ${edge.anchorLeft} ${edge.anchorTop} Q ${curveX} ${curveY} ${edge.nodeLeft} ${edge.nodeTop}`}
              key={`${edge.anchorId}-${edge.paperKey}`}
              // Provenance, not relatedness: an edge the author actually drew by citing is solid,
              // one an algorithm proposed is faint. Distance already carries relevance.
              style={{ "--edge-opacity": 0.2 + edge.confidence * 0.62 } as CSSProperties}
            />
          );
        })}
        {secondaryEdges.map((edge) => {
          const curveX = edge.anchorLeft + (edge.node.left - edge.anchorLeft) * 0.52;
          const curveY = edge.anchorTop + (edge.node.top - edge.anchorTop) * 0.48 +
            (edge.node.top < edge.anchorTop ? -10 : 10);
          return (
            <path
              aria-label={`次级关联：${edge.paperKey} 与 ${edge.anchorLabel}`}
              className="association-edge is-crossing is-secondary"
              d={`M ${edge.anchorLeft} ${edge.anchorTop} Q ${curveX} ${curveY} ${edge.node.left} ${edge.node.top}`}
              key={`secondary-${edge.anchorId}-${edge.paperKey}`}
              role="img"
              style={{ "--edge-opacity": 0.52 } as CSSProperties}
            />
          );
        })}
      </svg>

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
        const anchorIds = projectedNodeByPaperKey.get(node.paperKey)?.anchorIds ?? node.anchorIds;
        const crossing = anchorIds.length > 1;
        const dragPayload = toExternalPdfDragPayload(source);
        return (
          <button
            aria-label={`${source.title}，${associationRelationLabel(source.relation)}，${
              associationConfidenceLabel(source.confidenceBasis)
            }${crossing ? `，${anchorIds.length} 个锚点交叉` : ""}`}
            className={`association-node${node.isDot ? " is-dot" : ""}${
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
      {!activeSource ? (
        <div className="association-legend">
          <span><i className="association-legend__line" />作者亲引</span>
          <span><i className="association-legend__line is-weak" />算法检索</span>
          <span><i className="association-legend__line is-crossing" />多锚点交叉</span>
          <span className="association-legend__note">离锚点越近越相关</span>
        </div>
      ) : null}

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
