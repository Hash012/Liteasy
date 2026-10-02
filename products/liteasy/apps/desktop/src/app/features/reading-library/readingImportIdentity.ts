import { z } from "zod";
import type { ParsedReadingDocument } from "./readingDocument.types";

/** A provenance hint, never a permission to read a path or proof of a file rename. */
export const readingImportSourceSchema = z.object({
  kind: z.enum(["file-name", "relative-path", "source-path"]),
  location: z.string().min(1).max(4096).refine((value) => !value.includes("\0")),
});
export type ReadingImportSource = z.infer<typeof readingImportSourceSchema>;

export function readingImportSourceForFile(file: Pick<File, "name" | "webkitRelativePath">): ReadingImportSource {
  return readingImportSourceSchema.parse(file.webkitRelativePath
    ? { kind: "relative-path", location: file.webkitRelativePath }
    : { kind: "file-name", location: file.name });
}

/** Preserve exact source spelling and parsed bibliography; byte equality alone is insufficient. */
export function readingImportBibliography(document: ParsedReadingDocument) {
  return {
    format: document.format === "text" ? "txt" as const : document.format,
    title: document.title.slice(0, 1000), authors: document.authors,
    language: document.language, publication: document.publisher,
    publishedAt: document.publishedAt, identifier: document.identifier,
  };
}
