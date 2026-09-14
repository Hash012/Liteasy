import { createContext, useContext } from "react";
import type { NotesTarget } from "./notes.types";

export type NotesPort = {
  collect(target: NotesTarget, folderId?: string): Promise<void>;
  notifySourcesChanged(): void;
  open(): void;
};
export const NotesContext = createContext<NotesPort | null>(null);
export const useNotes = () => useContext(NotesContext);
export const NOTES_SOURCES_CHANGED = "liteasy:notes-sources-changed";
export const NOTES_REFERENCE_MIME = "application/x-liteasy-note-reference+json";
/** Emit after the source's own save has completed, including native PDF saves. */
export function notifyNotesSourcesChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(NOTES_SOURCES_CHANGED));
}
