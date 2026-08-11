import type { KeyboardEvent, PointerEvent, WheelEvent } from "react";
import { useRef, useState } from "react";

export type CartesianViewport = {
  xMax: number;
  xMin: number;
  yMax: number;
  yMin: number;
};

type DragOrigin = {
  clientX: number;
  clientY: number;
  pointerId: number;
  viewport: CartesianViewport;
};

export function useCartesianViewport(initialViewport: CartesianViewport) {
  const [viewport, setViewport] = useState<CartesianViewport>(() => ({ ...initialViewport }));
  const dragOrigin = useRef<DragOrigin | null>(null);

  function zoom(factor: number) {
    setViewport((current) => zoomViewport(current, factor, initialViewport));
  }

  function pan(xFraction: number, yFraction: number) {
    setViewport((current) => panViewport(current, xFraction, yFraction));
  }

  function reset() {
    setViewport({ ...initialViewport });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragOrigin.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      viewport
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    setViewport(panViewport(
      origin.viewport,
      -(event.clientX - origin.clientX) / width,
      (event.clientY - origin.clientY) / height
    ));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    dragOrigin.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.25 : 0.1;
    if (event.key === "ArrowLeft") pan(-step, 0);
    else if (event.key === "ArrowRight") pan(step, 0);
    else if (event.key === "ArrowUp") pan(0, step);
    else if (event.key === "ArrowDown") pan(0, -step);
    else if (event.key === "+" || event.key === "=") zoom(0.8);
    else if (event.key === "-") zoom(1.25);
    else if (event.key === "0") reset();
    else return;
    event.preventDefault();
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.8 : 1.25);
  }

  return {
    onKeyDown,
    onPointerCancel: onPointerUp,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    pan,
    reset,
    viewport,
    viewportKey: formatViewport(viewport),
    zoomIn: () => zoom(0.8),
    zoomOut: () => zoom(1.25)
  };
}

export function formatViewport(viewport: CartesianViewport): string {
  return [viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax]
    .map((value) => Number(value.toFixed(6)).toString())
    .join(",");
}

function panViewport(viewport: CartesianViewport, xFraction: number, yFraction: number): CartesianViewport {
  const xShift = (viewport.xMax - viewport.xMin) * xFraction;
  const yShift = (viewport.yMax - viewport.yMin) * yFraction;
  return {
    xMax: viewport.xMax + xShift,
    xMin: viewport.xMin + xShift,
    yMax: viewport.yMax + yShift,
    yMin: viewport.yMin + yShift
  };
}

function zoomViewport(
  viewport: CartesianViewport,
  requestedFactor: number,
  initialViewport: CartesianViewport
): CartesianViewport {
  const initialXSpan = initialViewport.xMax - initialViewport.xMin;
  const initialYSpan = initialViewport.yMax - initialViewport.yMin;
  const xSpan = viewport.xMax - viewport.xMin;
  const ySpan = viewport.yMax - viewport.yMin;
  const factor = clampZoomFactor(
    requestedFactor,
    xSpan,
    ySpan,
    initialXSpan * 0.01,
    initialXSpan * 100,
    initialYSpan * 0.01,
    initialYSpan * 100
  );
  const centerX = (viewport.xMin + viewport.xMax) / 2;
  const centerY = (viewport.yMin + viewport.yMax) / 2;
  const nextXSpan = xSpan * factor;
  const nextYSpan = ySpan * factor;
  return {
    xMax: centerX + nextXSpan / 2,
    xMin: centerX - nextXSpan / 2,
    yMax: centerY + nextYSpan / 2,
    yMin: centerY - nextYSpan / 2
  };
}

function clampZoomFactor(
  requestedFactor: number,
  xSpan: number,
  ySpan: number,
  minXSpan: number,
  maxXSpan: number,
  minYSpan: number,
  maxYSpan: number
): number {
  const minimum = Math.max(minXSpan / xSpan, minYSpan / ySpan);
  const maximum = Math.min(maxXSpan / xSpan, maxYSpan / ySpan);
  return Math.min(Math.max(requestedFactor, minimum), maximum);
}
