import { createContext, useContext } from "react";
import type { Paper } from "../workspace/workspace.types";
import type { ObjectRef } from "./object.types";
import type { ContextRef } from "../context/objectContext";
import type { PdfAnnotationRect, PdfAnnotationV2 } from "../pdf/pdfAnnotationStorage";
export type PdfCaptureInput = {
  paper: Paper;
  page: number;
  excerpt: string;
  rects: PdfAnnotationRect[];
  normalizedStart?: number;
};
export type PdfAnnotationCaptureInput = {
  paper: Paper;
  annotation: PdfAnnotationV2;
  pageAspectRatio?: number;
};
export type MessageCaptureInput = {
  messageId: string;
  text: string;
  excerpt: string;
  partial: boolean;
};
export type ObjectWorkbenchPort = {
  resolveBoardFile?(file: import("../note-files/noteFileService").NoteFileSnapshot): Promise<ObjectRef>;
  receiveContextDrop?(data: Pick<DataTransfer, "getData">): Promise<import("../object-transfer/contextTransfer").ResourceContextAttachment[]>;
  capturePaperContext?(paperIds: string[]): Promise<ObjectRef[]>;
  captureArtifactPage?(input: { artifactId: string; pageId: string; title: string; text: string; paperIds: string[] }): Promise<ObjectRef>;
  readonly isOpen?: boolean;
  close?(): void;
  captureAnnotation?(input: PdfAnnotationCaptureInput, target: "board" | "tray"): Promise<ObjectRef[]>;
  dragAnnotation?(input: PdfAnnotationCaptureInput, data: DataTransfer): void;
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
