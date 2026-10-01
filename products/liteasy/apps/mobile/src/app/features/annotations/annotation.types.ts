import type { PdfAnnotationV2 } from "@liteasy/reading-core/pdfAnnotations";
import type { AnnotationInput } from "./annotationDocument";
export type AnnotationMode = "select" | "draw" | "erase" | "note" | "text";
export type AnnotationControls = {
  annotations: PdfAnnotationV2[]; ready: boolean; busy: boolean; error: string; canUndo: boolean; canRedo: boolean;
  add: (input: AnnotationInput) => Promise<boolean>; edit: (id: string, text: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>; undo: () => Promise<boolean>; redo: () => Promise<boolean>;
};
