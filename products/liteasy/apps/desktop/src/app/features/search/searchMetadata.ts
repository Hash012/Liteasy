import type { ReadingCatalogEntry } from "../library/readingCatalog.types";
import { inferAssetType, libraryEntryTags } from "../library/libraryAssetMetadata";
import { noteLabels, resolvedNoteLabels, type NoteLabelOverrides } from "../notes/noteLabels";
import type { NotesItem } from "../notes/notes.types";
import { formatFromName, type SearchMetadata } from "./searchQuery";

export function catalogSearchMetadata(entry: ReadingCatalogEntry): SearchMetadata {
  return { format: entry.format === "other" && entry.fileName?.includes(".") ? formatFromName(entry.fileName) : entry.format, assetType: entry.assetType || inferAssetType(entry.format),
    tags: libraryEntryTags(entry).flatMap((tag) => [tag.value, tag.label]) };
}
export function noteSearchMetadata(item: NotesItem, overrides?: NoteLabelOverrides): SearchMetadata {
  const labels = item.labels ?? resolvedNoteLabels(item, overrides);
  return { format: item.target.kind === "external-file" ? formatFromName(item.target.path) : item.annotation ? "pdf" : item.object?.kind === "workspace.board" ? "canvas" : item.object?.kind === "artifact.document" ? "json" : "markdown",
    assetType: item.object?.kind === "workspace.board" ? "board" : item.object?.kind === "artifact.document" ? "artifact" : "note",
    tags: labels.flatMap((label) => [label, noteLabels[label]]) };
}
