import { Button, Field, Input, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { useRef, useState, type CSSProperties } from "react";
import type { MineruFigure } from "../import/import.types";
import type { DeepDiveTargetV1 } from "../visualization/visualizationArtifact.types";
import { createSourceFigureTarget, createSourceRegionTarget } from "./thinReadingDeepDiveTarget";

type Drag = {
  displayRect: { left: number; top: number; width: number; height: number };
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

function dragRectangleStyle(drag: Drag): CSSProperties {
  const { displayRect } = drag;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const startX = clamp(Math.min(drag.startX, drag.endX), displayRect.left, displayRect.left + displayRect.width);
  const endX = clamp(Math.max(drag.startX, drag.endX), displayRect.left, displayRect.left + displayRect.width);
  const startY = clamp(Math.min(drag.startY, drag.endY), displayRect.top, displayRect.top + displayRect.height);
  const endY = clamp(Math.max(drag.startY, drag.endY), displayRect.top, displayRect.top + displayRect.height);
  return {
    background: "rgba(75, 159, 232, 0.16)",
    border: "2px solid #4b9fe8",
    height: `${((endY - startY) / displayRect.height) * 100}%`,
    left: `${((startX - displayRect.left) / displayRect.width) * 100}%`,
    pointerEvents: "none",
    position: "absolute",
    top: `${((startY - displayRect.top) / displayRect.height) * 100}%`,
    width: `${((endX - startX) / displayRect.width) * 100}%`
  };
}

export function SourceFigureSelectionOverlay(props: {
  evidenceIds: readonly string[];
  figure: MineruFigure;
  nodeId: string;
  onSelect: (target: DeepDiveTargetV1) => void;
  sourcePixelSize: { width: number; height: number };
}) {
  const { evidenceIds, figure, nodeId, onSelect, sourcePixelSize } = props;
  const imageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [region, setRegion] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const wholeFigure = () => onSelect(createSourceFigureTarget({ evidenceIds, nodeId, sourceFigureId: figure.id }));
  const submitRegion = () => {
    const element = imageRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    try {
      onSelect(createSourceRegionTarget({
        displayRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        drag: {
          startX: rect.left + (region.x / 100) * rect.width,
          startY: rect.top + (region.y / 100) * rect.height,
          endX: rect.left + ((region.x + region.width) / 100) * rect.width,
          endY: rect.top + ((region.y + region.height) / 100) * rect.height
        },
        evidenceIds,
        figureId: figure.id,
        nodeId,
        sourcePixelSize
      }));
      setRegionOpen(false);
    } catch {
      // Invalid or unavailable geometry is deliberately ignored; no branch is generated.
    }
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    setDrag({
      displayRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      startX: event.clientX,
      startY: event.clientY,
      endX: event.clientX,
      endY: event.clientY
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ ...drag, endX: event.clientX, endY: event.clientY });
  };
  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = imageRef.current?.getBoundingClientRect();
    setDrag(null);
    if (!rect) return;
    try {
      onSelect(createSourceRegionTarget({ displayRect: rect, drag: { ...drag, endX: event.clientX, endY: event.clientY }, evidenceIds, figureId: figure.id, nodeId, sourcePixelSize }));
    } catch {
      // Invalid/tiny regions are fail-closed.
    }
  };
  return <section aria-label="论文原图深入" className="thin-reading__figure-selection">
    <div
      className="thin-reading__figure-selection-image"
      data-testid="source-figure-selection-image"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      ref={imageRef}
      role="img"
      style={{ position: "relative", touchAction: "none" }}
      tabIndex={0}
      aria-label={figure.analysis?.title ?? figure.alt}
    >
      <img alt={figure.analysis?.title ?? figure.alt} src={figure.dataUrl} />
      {drag ? (
        <span
          aria-hidden="true"
          className="thin-reading__figure-selection-rect"
          data-testid="source-figure-selection-rect"
          style={dragRectangleStyle(drag)}
        />
      ) : null}
    </div>
    <div className="thin-reading__figure-selection-actions">
      <Button onClick={wholeFigure}>深入整图</Button>
      <Popover open={regionOpen} onOpenChange={(_, data) => setRegionOpen(data.open)}>
        <PopoverTrigger disableButtonEnhancement><Button>选择区域</Button></PopoverTrigger>
        <PopoverSurface>
          <div aria-label="区域坐标" className="thin-reading__figure-region-form">
            {(["x", "y", "width", "height"] as const).map((key) => <Field key={key} label={key}>
              <Input type="number" min={0} max={100} step={0.1} value={String(region[key])} onChange={(_, data) => setRegion((current) => ({ ...current, [key]: Math.min(100, Math.max(0, Number(data.value) || 0)) }))} />
            </Field>)}
            <Button appearance="primary" onClick={submitRegion}>深入此区域</Button>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  </section>;
}
