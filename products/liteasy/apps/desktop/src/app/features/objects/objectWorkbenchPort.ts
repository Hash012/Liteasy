import { createContext, useContext } from "react";
import type { Paper } from "../workspace/workspace.types";
import type { ObjectRef } from "./object.types";
import type { ContextRef } from "../context/objectContext";
import type { PdfAnnotationRect } from "../pdf/pdfAnnotationStorage";
export type PdfCaptureInput = {
  paper: Paper;
  page: number;
  excerpt: string;
  rects: PdfAnnotationRect[];
  normalizedStart?: number;
};
export type MessageCaptureInput = {
  messageId: string;
  text: string;
  excerpt: string;
  partial: boolean;
};
export type ObjectWorkbenchPort = {
  capturePdf(
    input: PdfCaptureInput,
    target: "board" | "tray",
  ): Promise<ObjectRef[]>;
  captureMessage(
    input: MessageCaptureInput,
    target: "board" | "tray",
  ): Promise<ObjectRef[]>;
  dragPdf(input: PdfCaptureInput, data: DataTransfer): void;
  dragMessage(input: MessageCaptureInput, data: DataTransfer): void;
  explain(ref: ContextRef): void;
  openLegacyBoard(
    paper: Paper,
    snapshot: import("../pdf/pdf-whiteboard/pdfWhiteboard.types").PdfWhiteboardDocument,
    key: string,
  ): Promise<void>;
  open(): void;
};
export const ObjectWorkbenchContext = createContext<ObjectWorkbenchPort | null>(
  null,
);
export const useObjectWorkbench = () => useContext(ObjectWorkbenchContext);
