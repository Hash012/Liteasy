import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../app/layout/AppShell";
import type { Paper } from "../../app/features/workspace/workspace.types";

function ImportablePdfBrowserFixture() {
  const [sourcePath, setSourcePath] = useState<string>();
  const [contentHash, setContentHash] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    void fetch("/manual-preview/das24a.pdf").then((response) => response.blob()).then(async (blob) => {
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setContentHash(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""));
      setSourcePath(url);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, []);
  const paper = useMemo<Paper>(() => ({ id: "manual-das24a-preview", sourcePath, contentHash, title: "das24a.pdf" }), [sourcePath, contentHash]);
  const loader = useMemo(() => async () => ({
    entries: [{ contentHash: paper.contentHash ?? null, id: paper.id, path: paper.sourcePath!, relativePath: "das24a.pdf", title: paper.title }],
    folders: [], libraryId: "pdf-preview-library", revision: 1,
    rootPath: "/preview-library", trashEntries: []
  }), [paper]);
  return sourcePath ? <AppShell localLibraryLoader={loader} initialOpenReaderPaperIds={[paper.id]} initialPapers={[paper]} /> : null;
}

export default function PdfHighlightBrowserFixture() {
  if (window.location.hash === "#importable") return <ImportablePdfBrowserFixture />;
  const previewPaper: Paper = {
    id: "manual-das24a-preview",
    sourcePath: new URL("/manual-preview/das24a.pdf", window.location.origin).href,
    title: "das24a.pdf"
  };
  return <AppShell initialOpenReaderPaperIds={[previewPaper.id]} initialPapers={[previewPaper]} />;
}
