import type { NotesItem } from "../notes/notes.types";
import { createContext, useContext } from "react";
import type { ArtifactTab } from "../artifacts/artifact.types";
import type { ArtifactExportOutcome, ArtifactExportPayload } from "../artifacts/artifactExport.types";
import type { ExportDocument, ExportOptions } from "./documentExport.types";
export type DocumentExportPort = {
  compileArtifact(tab: ArtifactTab, options: Partial<ExportOptions>, signal?: AbortSignal): Promise<ExportDocument>;
  compileNote(item: NotesItem, options: Partial<ExportOptions>, signal?: AbortSignal): Promise<ExportDocument>;
  publish(payload: ArtifactExportPayload, signal?: AbortSignal): Promise<ArtifactExportOutcome>;
};
export const DocumentExportContext = createContext<DocumentExportPort | null>(null);
export const useDocumentExportPort = () => useContext(DocumentExportContext);
