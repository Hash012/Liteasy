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
    kind: item.annotation ? "annotation" : item.object?.kind === "workspace.board" ? "board" : item.object?.kind === "artifact.document" ? "artifact" : item.object?.kind === "content.fragment" ? "excerpt" : "note",
    updatedAt: item.updatedAt,
    origin: item.target.kind === "external-file" || labels.includes("external") ? "external"
      : labels.includes("ai-generated") && (labels.includes("user-edited") || labels.includes("personal")) ? "mixed"
        : labels.includes("user-edited") || labels.includes("personal") ? "user"
          : labels.includes("ai-generated") ? "agent" : item.object?.createdBy.type ?? "unknown",
    tags: labels.flatMap((label) => [label, noteLabels[label]]) };
}
