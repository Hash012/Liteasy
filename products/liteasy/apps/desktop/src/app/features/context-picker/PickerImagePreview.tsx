import { useEffect, useRef, useState } from "react";
import { ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import { ActionButton, IconAction } from "../../shared/ui/productPrimitives";
import type { PreviewViewport } from "../resource-links/referencePdfSource";
import { usePreviewScroll } from "../resource-links/usePreviewScroll";
export function PickerImagePreview({ url, label, initialViewport, onViewportChange }: { url: string; label: string; initialViewport?: PreviewViewport; onViewportChange?(viewport: PreviewViewport): void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(initialViewport?.zoom ?? 1);
  const [loaded, setLoaded] = useState(false);
  usePreviewScroll(stage, loaded, initialViewport, onViewportChange);
  const callback = useRef(onViewportChange); callback.current = onViewportChange;
  useEffect(() => { callback.current?.({ zoom }); }, [zoom]);
  const drag = useRef<{ x: number; y: number; left: number; top: number }>();
  return <div className="picker-image-preview">
    <div className="picker-image-toolbar">
      <IconAction label="缩小图片" appearance="subtle" icon={<ZoomOutRegular />} disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(.5, value - .25))} />
      <ActionButton appearance="subtle" size="small" onClick={() => setZoom(1)}>适应区域</ActionButton>
      <ActionButton appearance="subtle" size="small" onClick={() => setZoom(0)}>100%</ActionButton>
      <IconAction label="放大图片" appearance="subtle" icon={<ZoomInRegular />} disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, (value || 1) + .25))} />
    </div>
    <div ref={stage} className="picker-image-stage" onPointerDown={event => { if (event.button !== 0) return; const node = event.currentTarget; drag.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }; node.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) { event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX; event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY; } }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      <img src={url} alt={label} onLoad={() => setLoaded(true)} draggable={false} style={zoom === 0 ? { maxWidth: "none", maxHeight: "none" } : { width: `${zoom * 100}%`, height: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }} />
    </div>
  </div>;
}
