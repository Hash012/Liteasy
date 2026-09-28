import { getHighlightColor } from "../pdf/pdfAnnotationAppearance";
import { useEffect, useId, useRef, type RefObject } from "react";
import type { PdfAnnotationV2 } from "../pdf/pdfAnnotationStorage";
import { indexReadingHighlights, readingHighlightRange } from "./readingHighlightRanges";

const colors = { yellow: getHighlightColor("yellow"), red: getHighlightColor("red"), blue: getHighlightColor("blue"), green: getHighlightColor("green"), pink: getHighlightColor("pink"), default: "#1b66b3" };
export function useReadingHighlights(root: RefObject<HTMLElement>, annotations: readonly PdfAnnotationV2[], onSelect: (id: string) => void) {
  const prefix = `reading${useId().replace(/[^a-z0-9]/gi, "")}`;
  const callback = useRef(onSelect); callback.current = onSelect;
  useEffect(() => {
    const content = root.current;
    if (!content || typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return;
    const style = document.createElement("style");
    const names: string[] = [];
    for (const kind of ["highlight", "underline"]) for (const [color, hex] of Object.entries(colors)) {
      const name = `${prefix}${kind}${color}`;
      names.push(name);
      style.textContent += `::highlight(${name}) { ${kind === "highlight" ? `background-color: ${hex}70;` : `text-decoration: underline solid ${hex} 2px;`} }\n`;
    }
    document.head.appendChild(style);
    let marked: { id: string; range: Range }[] = [];
    let frame = 0;
    const paint = () => {
      frame = 0; marked = [];
      for (const name of names) CSS.highlights.delete(name);
      const groups = new Map<string, Range[]>();
      const index = indexReadingHighlights(content);
      for (const annotation of annotations) {
        if (annotation.kind !== "highlight" && annotation.kind !== "underline") continue;
        const range = readingHighlightRange(index, annotation.excerpt, annotation.page);
        if (!range) continue;
        marked.push({ id: annotation.id, range });
        const name = `${prefix}${annotation.kind}${annotation.color ?? (annotation.kind === "underline" ? "default" : "yellow")}`;
        groups.set(name, [...(groups.get(name) ?? []), range]);
      }
      for (const [name, ranges] of groups) CSS.highlights.set(name, new Highlight(...ranges));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(content, { childList: true, characterData: true, subtree: true });
    const select = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      const mark = marked.find(({ range }) => Array.from(range.getClientRects()).some((rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
      if (mark) callback.current(mark.id);
    };
    content.addEventListener("click", select);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); style.remove(); names.forEach((name) => CSS.highlights.delete(name)); content.removeEventListener("click", select); };
  }, [root, annotations, prefix]);
}
