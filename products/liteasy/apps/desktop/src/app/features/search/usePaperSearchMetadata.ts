import { inferAssetType } from "../library/libraryAssetMetadata";
import { useEffect, useState } from "react";
import { createObjectStorage, subscribeObjectStorage } from "../objects/objectStorage";
import { createReadingLibraryRepository } from "../reading-library/readingLibraryRepository";
import { applyBibliographicMetadata } from "../library/bibliographicFields";
import { loadPaperFileMetadata, PAPER_FILE_METADATA_SAVED_EVENT } from "../library/paperFileMetadata";
import type { Paper } from "../workspace/workspace.types";
import { catalogSearchMetadata } from "./searchMetadata";
import type { SearchMetadata } from "./searchQuery";

const pdfMetadata: SearchMetadata = { format: "pdf" };
export function usePaperSearchMetadata(paper: Paper | undefined, scope = "local") {
  const [saved, setSaved] = useState<{ key: string; metadata: SearchMetadata }>();
  const key = `${scope}:${paper?.id}`;
  const signature = JSON.stringify([paper?.title, paper?.literature?.documentType, paper?.literature?.subjects, paper?.authors, paper?.year, paper?.literature?.authors, paper?.literature?.year]);
  useEffect(() => {
    if (!paper) return;
    let active = true, revision = 0;
    const load = async () => {
      const request = ++revision;
      const [legacy, all] = await Promise.all([loadPaperFileMetadata(paper.id), createReadingLibraryRepository(createObjectStorage(scope, () => active ? scope : ""), scope).metadata()]);
      const overlay = all[paper.id];
      const entry = applyBibliographicMetadata({ id: paper.id, title: paper.title, format: "pdf", subjects: paper.literature?.subjects, assetType: inferAssetType("pdf", paper.literature?.documentType), authors: paper.literature?.authors ?? (typeof paper.authors === "string" ? [paper.authors] : [...(paper.authors ?? [])]), year: Number(paper.literature?.year ?? paper.year) || undefined, ...legacy, ...overlay }, overlay?.bibliographic);
      if (active && request === revision) setSaved({ key, metadata: catalogSearchMetadata(entry) });
    };
    const reload = () => { void load().catch(() => { /* Unknown tags never satisfy inclusion filters. */ }); };
    const changed = (event: Event) => { if ((event as CustomEvent).detail === paper.id) reload(); };
    reload(); window.addEventListener(PAPER_FILE_METADATA_SAVED_EVENT, changed);
    const off = subscribeObjectStorage(scope, (keys) => { if (!keys || keys.includes(`reading-library/metadata/${paper.id}`)) reload(); });
    return () => { active = false; off(); window.removeEventListener(PAPER_FILE_METADATA_SAVED_EVENT, changed); };
  }, [key, signature]);
  return saved?.key === key ? saved.metadata : pdfMetadata;
}
