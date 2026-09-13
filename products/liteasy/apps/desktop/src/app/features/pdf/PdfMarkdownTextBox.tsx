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
  ImageAddRegular,
  CheckmarkRegular,
  TransparencySquareRegular
} from "@fluentui/react-icons";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { readPdfTextBoxImage, type PdfTextBoxImages } from "./pdfTextBoxImages";
import type { PdfAnnotationRect, PdfAnnotationV2 } from "./pdfAnnotationStorage";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";

type PdfMarkdownTextBoxProps = {
  active: boolean;
  annotation: PdfAnnotationV2;
  onActivate: (annotationId: string) => void;
  onCommit: (annotationId: string, markdown: string, rect: PdfAnnotationRect, images?: PdfTextBoxImages) => void;
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
  const rootRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [images, setImages] = useState<PdfTextBoxImages>(annotation.images ?? {});
  const [imageError, setImageError] = useState("");
  const [imagePending, setImagePending] = useState(false);
  const [surface, setSurface] = useState({ width: 760, height: 980 });
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const fallback = resizePdfTextBoxRect(draggedRect ?? rect, draft);
  const size = measured ?? { width: fallback.width, height: fallback.height };
  const position = draggedRect ?? rect;
  const boxRect = { ...size, left: clamp(position.left, 0, 100 - size.width), top: clamp(position.top, 0, 100 - size.height) };
  useEffect(() => {
    const page = rootRef.current?.closest(".pdf-page-shell")?.querySelector(".pdf-text-layer");
    if (!page) return;
    const update = () => {
      const bounds = page.getBoundingClientRect();
      if (bounds.width && bounds.height) setSurface({ width: bounds.width, height: bounds.height });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update); observer.observe(page);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const next = { width: Math.min(98, (bounds.width + 2) / surface.width * 100), height: Math.min(98, (bounds.height + 2) / surface.height * 100) };
      setMeasured((previous) => previous && Math.abs(previous.width - next.width) < .01 && Math.abs(previous.height - next.height) < .01 ? previous : next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [active, draft, images, surface]);
  const opacity = annotation.opacity ?? 0.96;
  const boxRectRef = useRef(boxRect);
  boxRectRef.current = boxRect;

  useEffect(() => {
    if (!active) {
      setDraft(annotation.note ?? "");
      setImages(annotation.images ?? {});
      setDraggedRect(null);
    }
  }, [active, annotation.note, annotation.images, rect.left, rect.top]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  function finishEditing() {
    if (!imagePending) {
      const retained = Object.fromEntries(Object.entries(images).filter(([id]) => draft.includes(`attachment:${id}`)));
      onCommit(annotation.id, draft, boxRectRef.current, Object.keys(retained).length ? retained : undefined);
    }
  }

  useEffect(() => {
    if (!active) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target) &&
        !(target instanceof Element && target.closest(".pdf-markdown-text-box-opacity-popover"))) finishEditing();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [active, draft, images, imagePending]);

  async function insertImage(file: File) {
    setImagePending(true); setImageError("");
    try {
      const data = await readPdfTextBoxImage(file);
      if (Object.values(images).reduce((sum, value) => sum + value.length, 0) + data.length > 4_000_000 || Object.keys(images).length >= 16) {
        throw new Error("此文本框中的图片总量已达上限，请先移除部分图片。");
      }
      const id = crypto.randomUUID();
      const position = inputRef.current?.selectionStart ?? draft.length;
      setImages((current) => ({ ...current, [id]: data }));
      setDraft((current) => `${current.slice(0, position)}\n![图片](attachment:${id})\n${current.slice(position)}`);
    } catch (error) { setImageError(error instanceof Error ? error.message : "图片读取失败"); }
    finally { setImagePending(false); inputRef.current?.focus(); }
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
      ref={rootRef}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !(event.relatedTarget instanceof Element && event.relatedTarget.closest(".pdf-markdown-text-box-opacity-popover"))) finishEditing();
      }}
      aria-label={`Markdown 文本框：第 ${annotation.page} 页`}
      className={`pdf-markdown-text-box ${active ? "is-editing" : ""} ${dragging ? "is-dragging" : ""} ${opacity === 0 ? "is-transparent" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        "--pdf-text-box-opacity": opacity,
        "--pdf-text-size": `${12 * surface.width / 760}px`,
        height: `${boxRect.height}%`,
        left: `${boxRect.left}%`,
        top: `${boxRect.top}%`,
        width: `${boxRect.width}%`
      } as CSSProperties}
    >
      <div aria-hidden="true" className="pdf-text-box-measure" ref={measureRef} style={{ maxWidth: surface.width * .52, minWidth: surface.width * .03 }}>
        {active ? (
          <div className="pdf-text-box-source-measure">{`${draft || "输入文字"}\u200b`}</div>
        ) : <PdfAnnotationMarkdown emptyLabel="输入文字" value={draft} images={images} />}
      </div>
      {active ? (
        <textarea
          ref={inputRef}
          aria-label={`编辑第 ${annotation.page} 页 Markdown 文本框`}
          autoFocus
          maxLength={10_000}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
            if (file) { event.preventDefault(); void insertImage(file); }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
              finishEditing();
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
          <PdfAnnotationMarkdown emptyLabel="点击输入 Markdown" value={annotation.note ?? ""} images={annotation.images} />
        </div>
      )}
      {active ? <div className="pdf-markdown-text-box-actions" role="toolbar" aria-label="文本框操作"
        style={{ ...(boxRect.top < 6 ? { top: "100%", bottom: "auto" } : {}), ...(boxRect.left > 70 ? { right: 0, left: "auto" } : { left: 0, right: "auto" }) }}
        onPointerDown={(event) => { if (event.target instanceof Element && event.target.closest("button")) event.preventDefault(); }}>
        <input ref={fileRef} type="file" aria-label="文本框图片文件" hidden accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void insertImage(file); }} />
        <Button aria-label="保存 Markdown 文本框" title="保存并收起工具" icon={<CheckmarkRegular />} appearance="subtle" size="small" disabled={imagePending} onClick={finishEditing} />
        <Button aria-label="在文本框中插入图片" title="插入图片（也可粘贴）" icon={<ImageAddRegular />} appearance="subtle" size="small" disabled={imagePending} onClick={() => fileRef.current?.click()} />
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
        <Button
          aria-label="删除 Markdown 文本框"
          appearance="subtle"
          icon={<DeleteRegular />}
          onClick={() => onDelete(annotation)}
          size="small"
          title="删除 Markdown 文本框"
        />
      </div> : null}
      {active && imageError ? <div className="pdf-text-box-error" role="alert">{imageError}</div> : null}
    </section>
  );
}
