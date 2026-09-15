import type { PdfAnnotationCaptureInput } from "../objects/objectWorkbenchPort";
import { pdfAnnotationReviewMarkdown } from "./pdfAnnotationReview";
import type { PdfAnnotationRect } from "./pdfAnnotationStorage";
import { pdfInkGroupBounds, pdfInkStrokes } from "./pdfInk";

export type PdfAnnotationCaptureMaterial = {
  text: string;
  quote: string;
  rects: PdfAnnotationRect[];
  images: Record<string, string>;
};

/** Export the stored annotation, including all drawing strokes, without changing its privacy. */
export async function preparePdfAnnotationCapture({
  annotation,
  pageAspectRatio = Math.SQRT2,
}: PdfAnnotationCaptureInput): Promise<PdfAnnotationCaptureMaterial> {
  const images = { ...annotation.images };
  const quote =
    annotation.kind === "ink" || annotation.kind === "text"
      ? ""
      : annotation.excerpt;
  let text = annotation.quickAsk
    ? `### ${annotation.quickAsk.question}\n\n${annotation.quickAsk.answer}`
    : annotation.note?.trim() || quote || (annotation.kind === "text" ? annotation.text.trim() : "");
  if (annotation.kind === "ink") {
    const strokes = pdfInkStrokes(annotation);
    if (!strokes.length) throw new Error("手绘笔记没有可读取的笔迹。");
    const bounds = pdfInkGroupBounds(strokes);
    const ratio =
      Number.isFinite(pageAspectRatio) && pageAspectRatio > 0
        ? pageAspectRatio
        : Math.SQRT2;
    // Crop in page coordinates so separated strokes keep their relative scale and position.
    const padding = Math.max(...strokes.map((stroke) => stroke.width), 0.4);
    const width = Math.max(0.1, bounds.width + padding * 2);
    const height = Math.max(0.1, (bounds.height + padding * 2) * ratio);
    const scale = Math.min(12, 1600 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法导出手绘图片，请重试。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) {
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width * scale;
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = (point.x - bounds.left + padding) * scale;
        const y = (point.y - bounds.top + padding) * ratio * scale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
        if (stroke.points.length === 1) context.lineTo(x + 0.01, y);
      });
      context.stroke();
    }
    let imageId = "drawing";
    while (images[imageId]) imageId += "-ink";
    images[imageId] = canvas.toDataURL("image/png");
    text = [text, `![手绘笔记（${strokes.length} 笔）](attachment:${imageId})`]
      .filter(Boolean)
      .join("\n\n");
  }
  text = [text, pdfAnnotationReviewMarkdown(annotation)].filter(Boolean).join("\n\n");
  return {
    text: text || `第 ${annotation.page} 页笔记`,
    quote,
    rects: annotation.rects,
    images,
  };
}
