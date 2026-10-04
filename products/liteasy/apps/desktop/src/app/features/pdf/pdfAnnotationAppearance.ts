import type { CSSProperties } from "react";
import type { PdfAnnotationKind as AnnotationKind, PdfHighlightColor as HighlightColor, PdfAnnotationRect } from "./pdfAnnotationStorage";

export function getHighlightColor(color: HighlightColor): string {
  switch (color) {
    case "yellow":
      return "#ffeaa7";
    case "red":
      return "#fab1a0";
    case "blue":
      return "#74b9ff";
    case "green":
      return "#55efc4";
    case "pink":
      return "#fd79a8";
    default:
      return "#ffeaa7";
  }
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

