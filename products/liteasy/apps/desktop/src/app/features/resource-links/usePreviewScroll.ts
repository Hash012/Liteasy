import { useEffect, useRef, type RefObject } from "react";
import type { PreviewViewport } from "./referencePdfSource";
/** Restore only after content exists; publish scrolling at most once per animation frame. */
export function usePreviewScroll(stage: RefObject<HTMLDivElement>, ready: boolean, initial: PreviewViewport | undefined, onChange?: (patch: PreviewViewport) => void) {
  const starting = useRef(initial), callback = useRef(onChange), restored = useRef(false);
  callback.current = onChange;
  useEffect(() => {
    if (!ready || !stage.current) return;
    const node = stage.current;
    if (!restored.current) {
      if (starting.current?.scrollLeft !== undefined) node.scrollLeft = starting.current.scrollLeft;
      if (starting.current?.scrollTop !== undefined) node.scrollTop = starting.current.scrollTop;
      restored.current = true;
    }
    let frame = 0;
    const change = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => callback.current?.({ scrollLeft: node.scrollLeft, scrollTop: node.scrollTop })); };
    node.addEventListener("scroll", change, { passive: true });
    return () => { cancelAnimationFrame(frame); node.removeEventListener("scroll", change); };
  }, [stage, ready]);
}
