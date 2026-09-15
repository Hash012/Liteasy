import type { ObjectEnvelope, ObjectRef } from "../objects/object.types";
import type { NoteFileSnapshot } from "../note-files/noteFileService";
import type { Paper } from "../workspace/workspace.types";
import type { PdfAnnotationV2 } from "../pdf/pdfAnnotationStorage";

/** Targets contain identity only. Original bodies and publication state stay with their owner. */
export type NotesTarget =
  | { kind: "object"; ref: ObjectRef; followLatest?: boolean }
  | { kind: "pdf-annotation"; paperId: string; annotationId: string }
  | { kind: "artifact-annotation"; artifactId: string; annotationId: string }
  | { kind: "external-file"; mountId: string; path: string };
export type NotesFolder = {
  folderId: string;
  parentId: string;
  name: string;
  system?: boolean;
  external?: { mountId: string; path: string };
};
export type NotesReference = {
  entryId: string;
  folderId: string;
  target: NotesTarget;
  createdAt: string;
};
export type NotesItem = {
  paperAnchors?: import("../paper-anchors/paperAnchorEntity").PaperAnchorEntity[];
  key: string;
  target: NotesTarget;
  title: string;
  text: string;
  source: string;
  defaultFolderId: string;
  updatedAt: string;
  editable: boolean;
  unavailable?: boolean;
  automaticallyListed?: boolean;
  object?: ObjectEnvelope;
  paper?: Paper;
  annotation?: PdfAnnotationV2;
  artifactId?: string;
  nodeId?: string;
  entryId?: string;
  file?: NoteFileSnapshot;
};
export type NotesViewModel = {
  folders: NotesFolder[];
  folderId: string;
  items: NotesItem[];
  query: string;
  busy: boolean;
  error: string;
  sourceWarning?: string;
  selected?: NotesItem;
  selectFolder(folderId: string): void;
  selectItem(item: NotesItem): void;
  search(query: string): void;
  refresh(): Promise<void>;
  connectFolder(): Promise<void>;
  importFiles(files?: File[]): Promise<void>;
  createFolder(name: string): Promise<void>;
  removeFolder(): Promise<void>;
  createNote(text: string): Promise<void>;
  editNote(item: NotesItem, text: string): Promise<void>;
  collect(item: NotesItem, folderId: string): Promise<void>;
  removeReference(item: NotesItem): Promise<void>;
  openSource(item: NotesItem): void;
  drag(item: NotesItem, data: DataTransfer): void;
  drop(data: DataTransfer, folderId: string): Promise<void>;
};
export const NOTES_ROOT = "root";
export const DEFAULT_NOTES_FOLDERS: NotesFolder[] = [
  { folderId: "default", parentId: NOTES_ROOT, name: "default", system: true },
  ...["paper", "board", "note", "artifact"].map((name) => ({
    folderId: `default/${name}`,
    parentId: "default",
    name,
    system: true,
  })),
];
export function notesTargetKey(target: NotesTarget): string {
  return target.kind === "object"
    ? `object:${target.ref.objectId}:${target.followLatest ? "latest" : target.ref.revision}:${target.ref.selectorId ?? ""}`
    : target.kind === "pdf-annotation"
      ? `pdf:${target.paperId}:${target.annotationId}`
      : target.kind === "artifact-annotation"
        ? `artifact-annotation:${target.artifactId}:${target.annotationId}`
        : `external-file:${target.mountId}:${target.path}`;
}
