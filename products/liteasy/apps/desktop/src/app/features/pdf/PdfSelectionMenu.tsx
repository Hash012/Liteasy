import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fitPdfSelectionMenuPosition, type PdfSelectionMenuPosition } from "./pdfSelectionPosition";

export function PdfSelectionMenu({ anchor, stageRef, children }: {
  anchor: PdfSelectionMenuPosition;
  stageRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{ left: number; top: number; maxHeight?: number }>({
    left: anchor.left, top: anchor.top
  });
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const menu = menuRef.current;
    if (!stage || !menu) return;
    const update = () => {
      if (!stage.clientWidth || !stage.clientHeight) return;
      const next = fitPdfSelectionMenuPosition({
        anchor, menuWidth: menu.offsetWidth, menuHeight: menu.scrollHeight + 2,
        viewportWidth: stage.clientWidth, viewportHeight: stage.clientHeight,
        scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop
      });
      setBounds((previous) => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(stage);
    observer?.observe(menu);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [anchor.left, anchor.top, anchor.placement, stageRef]);
  return <div aria-label="选中文本批注菜单" className="pdf-selection-menu" ref={menuRef} style={bounds}>
    {children}
  </div>;
}
