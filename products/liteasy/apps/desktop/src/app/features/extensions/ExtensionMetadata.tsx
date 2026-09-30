import { useMemo } from "react";
import { useExtensionWorkbench } from "./extensionWorkbenchContext";
import type { ReadingCatalogEntry } from "../library/readingCatalog.types";
import { ComponentTreeView } from "../visual-blocks/ComponentTreeView";
import { validateComponentTree } from "../visual-blocks/blockRegistry";
import { VisualBlockBase } from "../visual-blocks/VisualBlockBase";
import type { JsonObject } from "./extensionSchema";
const dataOf = (entry: ReadingCatalogEntry): JsonObject => Object.fromEntries(["title", "authors", "year", "publication", "doi", "subjects", "format", "collection", "summary"].map((key) => { const value = (entry as unknown as Record<string, unknown>)[key]; return [key, Array.isArray(value) ? value.join(" · ") : typeof value === "number" || typeof value === "string" ? value : ""]; }));
/** Slots use already-loaded metadata; rendering a column never starts a per-row network request. */
export function ExtensionLibraryColumns({ entry }: { entry: ReadingCatalogEntry }) {
  const host = useExtensionWorkbench(), data = dataOf(entry);
  const columns = host?.packages.snapshot.packages.flatMap((pkg) => (pkg.manifest.contributes.libraryColumns ?? []).map((column) => ({ ...column, owner: pkg.manifest.id, source: pkg.manifest.name }))).slice(0, 4) ?? [];
  return <>{columns.filter((column) => data[column.field] !== "").map((column) => <span key={`${column.owner}/${column.id}`} className="library-tag-chip library-tag-tag" title={`${column.title} · ${column.source}`} tabIndex={0}>{column.prefix}{String(data[column.field])}</span>)}</>;
}
export function ExtensionMetadataSections({ entry }: { entry: ReadingCatalogEntry }) {
  const host = useExtensionWorkbench();
  const sections = useMemo(() => host?.packages.snapshot.packages.flatMap((pkg) => (pkg.manifest.contributes.metadataSections ?? []).map((section) => ({ ...section, owner: pkg.manifest.id, source: pkg.manifest.name, tree: validateComponentTree(JSON.parse(pkg.bundle.files[section.path])) }))).slice(0, 8) ?? [], [host?.packages.snapshot]);
  return <>{sections.map((section) => <details key={`${section.owner}/${section.id}`}><summary>{section.title} · {section.source}</summary><VisualBlockBase identity={`${entry.id}:${section.owner}/${section.id}`} fallback={entry.title}><ComponentTreeView tree={section.tree} data={dataOf(entry)} openPath={host?.openLink} /></VisualBlockBase></details>)}</>;
}
