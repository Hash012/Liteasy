import type { CSSProperties } from "react";
import type { PdfAnnotationKind as AnnotationKind, PdfHighlightColor as HighlightColor, PdfAnnotationRect } from "./pdfAnnotationStorage";

export const pdfAnnotationColorLabels: Record<HighlightColor, string> = {
  yellow: "黄色", red: "红色", blue: "蓝色", green: "绿色", pink: "粉色",
  orange: "橙色", purple: "紫色", cyan: "青色", gray: "灰色"
};
export const pdfAnnotationColors: Record<HighlightColor, string> = {
  yellow: "#ffeaa7", red: "#fab1a0", blue: "#74b9ff", green: "#55efc4", pink: "#fd79a8",
  orange: "#ffb366", purple: "#c3a6ff", cyan: "#76d7ea", gray: "#b8bfc8"
};
export function getHighlightColor(color: HighlightColor): string {
  return pdfAnnotationColors[color] ?? pdfAnnotationColors.yellow;
}

export function getOverlayStyle(kind: AnnotationKind, rect: PdfAnnotationRect, color?: HighlightColor): CSSProperties {
  if (kind === "note") {
    return {
      backgroundColor: "rgba(36, 80, 142, 0.95)",
      borderRadius: "999px",
      height: "2%",
      left: `${Math.max(0, rect.left - 1.2)}%`,
      top: `${rect.top + Math.min(rect.height, 1)}%`,
      width: "2%"
    };
  }

  if (kind === "underline") {
    return {
      border: "none",
      boxShadow: "none",
      background: "none",
      height: `${rect.height}%`,
      left: `${rect.left}%`,
      top: `${rect.top}%`,
      width: `${rect.width}%`,
      borderRadius: 0,
      borderBottom: `2px solid ${color ? getHighlightColor(color) : "rgba(27, 102, 179, 0.8)"}`
    };
  }

  const highlightColor = color ? getHighlightColor(color) : getHighlightColor("yellow");
  const verticalInset = rect.height * 0.05;

  return {
    backgroundColor: highlightColor,
    height: `${rect.height - verticalInset * 2}%`,
    left: `${rect.left}%`,
    top: `${rect.top + verticalInset}%`,
    width: `${rect.width}%`
  };
}

