import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

import type { AnchorRect } from "./associationGraphLayout";

export type AnchorRectMeasurement = {
  /** Full scrollable height of the container, so the layer can cover all of it. */
  height: number;
  rectsByAnchorId: Readonly<Record<string, readonly AnchorRect[]>>;
  width: number;
};

const emptyMeasurement: AnchorRectMeasurement = { height: 0, rectsByAnchorId: {}, width: 0 };

function sameMeasurement(left: AnchorRectMeasurement, right: AnchorRectMeasurement) {
  if (left.height !== right.height || left.width !== right.width) return false;
  const leftIds = Object.keys(left.rectsByAnchorId);
  const rightIds = Object.keys(right.rectsByAnchorId);
  if (leftIds.length !== rightIds.length) return false;
  return leftIds.every((anchorId) => {
    const before = left.rectsByAnchorId[anchorId];
    const after = right.rectsByAnchorId[anchorId];
    return after && before.length === after.length && before.every((rect, index) =>
      rect.height === after[index].height && rect.left === after[index].left &&
      rect.top === after[index].top && rect.width === after[index].width);
  });
}

/**
 * Where the anchors actually are, read from laid-out text.
 *
 * Anchors in generated prose are inline `<mark>`s: they move when the window resizes, when a font
 * finishes loading, and when the text itself changes — so their positions cannot be computed, only
 * measured, and measured again whenever the layout settles differently. A wrapped anchor reports
 * one rectangle per line (`getClientRects`), which is what lets the highlight follow the text
 * instead of drawing one box across the gap.
 *
 * Measurements are in the container's own coordinates, so the caller can position an absolutely
 * placed layer inside it and scroll the two together without ever recomputing.
 */
export function useAnchorRects(input: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Anything that re-flows the text: the active node, its sources, a collapsed side rail. */
  signature: string;
}): AnchorRectMeasurement {
  const { containerRef, enabled, signature } = input;
  const [measurement, setMeasurement] = useState<AnchorRectMeasurement>(emptyMeasurement);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setMeasurement((current) => (current === emptyMeasurement ? current : emptyMeasurement));
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rectsByAnchorId: Record<string, AnchorRect[]> = {};
    for (const element of container.querySelectorAll<HTMLElement>("[data-anchor-id]")) {
      const anchorId = element.dataset.anchorId;
      if (!anchorId) continue;
      const rects = Array.from(element.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          height: rect.height,
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width
        }));
      if (rects.length > 0) rectsByAnchorId[anchorId] = rects;
    }
    const next: AnchorRectMeasurement = {
      height: container.scrollHeight,
      rectsByAnchorId,
      width: container.clientWidth
    };
    setMeasurement((current) => (sameMeasurement(current, next) ? current : next));
  }, [containerRef]);

  useLayoutEffect(() => {
    if (!enabled) {
      setMeasurement((current) => (current === emptyMeasurement ? current : emptyMeasurement));
      return undefined;
    }
    measure();
    const container = containerRef.current;
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (container) observer?.observe(container);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, enabled, measure, signature]);

  // A web font landing after the first paint re-wraps every line under it, and the anchors with
  // them. Without this the graph points at where the text used to be.
  useEffect(() => {
    if (!enabled || typeof document === "undefined" || !document.fonts?.ready) return undefined;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, measure, signature]);

  return measurement;
}
