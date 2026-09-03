import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Slider
} from "@fluentui/react-components";
import {
  DeleteRegular,
  DragRegular,
  EditRegular,
  TransparencySquareRegular
} from "@fluentui/react-icons";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { PdfAnnotationRect, PdfAnnotationV2 } from "./pdfAnnotationStorage";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";

type PdfMarkdownTextBoxProps = {
  active: boolean;
  annotation: PdfAnnotationV2;
  onActivate: (annotationId: string) => void;
  onCommit: (annotationId: string, markdown: string, rect: PdfAnnotationRect) => void;
  onDelete: (annotation: PdfAnnotationV2) => void;
  onMove: (annotationId: string, rect: PdfAnnotationRect) => void;
  onOpacityChange: (annotationId: string, opacity: number) => void;
  rect: PdfAnnotationRect;
};

const minimumTextBoxWidth = 8;
const minimumTextBoxHeight = 3.8;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resizePdfTextBoxRect(rect: PdfAnnotationRect, markdown: string): PdfAnnotationRect {
  const lines = markdown.trimEnd().split("\n");
  const measureLine = (line: string) => Array.from(line).reduce((width, character) => {
    if (character === "\t") return width + 4;
    return width + (/[^\u0000-\u00ff]/u.test(character) ? 1.65 : 1);
  }, 0);
  const longestLine = lines.reduce((longest, line) => Math.max(longest, measureLine(line)), 0);
  const width = clamp(5.4 + longestLine * 0.68, minimumTextBoxWidth, 52);
  const approximateCharactersPerLine = Math.max(1, (width - 4) / 0.68);
  const visualLineCount = lines.reduce(
    (count, line) => count + Math.max(1, Math.ceil(measureLine(line) / approximateCharactersPerLine)),
    0
  );
  const height = clamp(1.45 + visualLineCount * 2.15, minimumTextBoxHeight, 48);
  return {
    height,
    left: clamp(rect.left, 0, 100 - width),
    top: clamp(rect.top, 0, 100 - height),
    width
  };
}

/**
 * A single-surface Markdown editor: the box is formatted at rest and turns into its source editor
 * in place while focused. This keeps the PDF free of a second preview panel while preserving a
 * predictable plain-text editing path for Markdown, fenced code and LaTeX.
 */
export function PdfMarkdownTextBox({
  active,
  annotation,
  onActivate,
  onCommit,
  onDelete,
  onMove,
  onOpacityChange,
  rect
}: PdfMarkdownTextBoxProps) {
  const [draft, setDraft] = useState(annotation.note ?? "");
  const [draggedRect, setDraggedRect] = useState<PdfAnnotationRect | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const boxRect = resizePdfTextBoxRect(draggedRect ?? rect, draft);
  const opacity = annotation.opacity ?? 0.96;
  const boxRectRef = useRef(boxRect);
  boxRectRef.current = boxRect;

  useEffect(() => {
    if (!active) {
      setDraft(annotation.note ?? "");
      setDraggedRect(null);
    }
  }, [active, annotation.note, rect.left, rect.top]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  function finishEditing() {
    onCommit(annotation.id, draft, boxRectRef.current);
  }

  function startDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const pageElement = event.currentTarget.closest<HTMLElement>(".pdf-page-shell");
    if (!pageElement) return;
    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = boxRectRef.current;
    setDragging(true);
    event.preventDefault();
    event.stopPropagation();

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextRect = {
        ...startRect,
        left: clamp(
          startRect.left + (pointerEvent.clientX - startX) / pageRect.width * 100,
          0,
          100 - startRect.width
        ),
        top: clamp(
          startRect.top + (pointerEvent.clientY - startY) / pageRect.height * 100,
          0,
          100 - startRect.height
        )
      };
      boxRectRef.current = nextRect;
      setDraggedRect(nextRect);
    };
    const cleanupDragging = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDragging);
      window.removeEventListener("pointercancel", finishDragging);
      dragCleanupRef.current = null;
    };
    const finishDragging = () => {
      cleanupDragging();
      setDragging(false);
      onMove(annotation.id, boxRectRef.current);
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanupDragging;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDragging);
    window.addEventListener("pointercancel", finishDragging);
  }

  return (
    <section
      aria-label={`Markdown 文本框：第 ${annotation.page} 页`}
      className={`pdf-markdown-text-box ${active ? "is-editing" : ""} ${dragging ? "is-dragging" : ""} ${opacity === 0 ? "is-transparent" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        "--pdf-text-box-opacity": opacity,
        height: `${boxRect.height}%`,
        left: `${boxRect.left}%`,
        top: `${boxRect.top}%`,
        width: `${boxRect.width}%`
      } as CSSProperties}
    >
      {active ? (
        <textarea
          aria-label={`编辑第 ${annotation.page} 页 Markdown 文本框`}
          autoFocus
          maxLength={10_000}
          onBlur={finishEditing}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
              event.currentTarget.blur();
              event.preventDefault();
            }
          }}
          placeholder="输入 Markdown、公式 $E=mc^2$ 或代码块…"
          value={draft}
        />
      ) : (
        <div
          className="pdf-markdown-text-box-surface"
          onClick={(event) => {
            if (!(event.target instanceof Element && event.target.closest("a"))) {
              onActivate(annotation.id);
            }
          }}
          title="点击直接编辑 Markdown"
        >
          <PdfAnnotationMarkdown emptyLabel="点击输入 Markdown" value={annotation.note ?? ""} />
        </div>
      )}
      <div className="pdf-markdown-text-box-actions">
        <Button
          aria-label="拖动 Markdown 文本框"
          appearance="subtle"
          className="pdf-markdown-text-box-drag-handle"
          icon={<DragRegular />}
          onPointerDown={startDragging}
          size="small"
          title="拖动文本框"
        />
        <Popover positioning="above" withArrow>
          <PopoverTrigger disableButtonEnhancement>
            <Button
              aria-label="调整 Markdown 文本框透明度"
              appearance="subtle"
              icon={<TransparencySquareRegular />}
              size="small"
              title="调整透明度"
            />
          </PopoverTrigger>
          <PopoverSurface className="pdf-markdown-text-box-opacity-popover">
            <label>
              <span>透明度 {Math.round(opacity * 100)}%</span>
              <Slider
                aria-label="Markdown 文本框透明度"
                max={100}
                min={0}
                onChange={(_, data) => onOpacityChange(annotation.id, data.value / 100)}
                step={5}
                value={Math.round(opacity * 100)}
              />
            </label>
          </PopoverSurface>
        </Popover>
        {!active ? (
          <Button
            aria-label="编辑 Markdown 文本框"
            appearance="subtle"
            icon={<EditRegular />}
            onClick={() => onActivate(annotation.id)}
            size="small"
            title="编辑 Markdown 文本框"
          />
        ) : null}
        <Button
          aria-label="删除 Markdown 文本框"
          appearance="subtle"
          icon={<DeleteRegular />}
          onClick={() => onDelete(annotation)}
          size="small"
          title="删除 Markdown 文本框"
        />
      </div>
    </section>
  );
}
