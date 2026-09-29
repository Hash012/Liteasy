import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../app/layout/AppShell";
import type { Paper } from "../../app/features/workspace/workspace.types";

const loadFolderFixture = async () => ({
  entries: [], libraryId: "folder-preview-library", revision: 1,
  rootPath: "D:\\Library", trashEntries: [],
  folders: [{ name: "eBooks", path: "D:\\Library\\eBooks", parentPath: null }]
});

const aiPapers: Paper[] = [
  { id: "ai-current", title: "Current Research", sourcePath: new URL("/manual-preview/current.pdf", window.location.origin).href },
  { id: "ai-recent", title: "Recent Research", sourcePath: new URL("/manual-preview/recent.pdf", window.location.origin).href },
  { id: "ai-archive", title: "Archived Methods", sourcePath: new URL("/manual-preview/Research/methods.pdf", window.location.origin).href }
];
const loadAiFixture = async () => ({
  entries: aiPapers.map((paper) => ({ id: paper.id, path: paper.sourcePath!, title: paper.title, contentHash: null, relativePath: paper.id === "ai-archive" ? "Research/methods.pdf" : `${paper.id}.pdf` })),
  folders: [{ name: "Research", path: new URL("/manual-preview/Research", window.location.origin).href, parentPath: null }],
  rootPath: new URL("/manual-preview", window.location.origin).href, libraryId: "ai-library", revision: 1, trashEntries: []
});

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
  return sourcePath ? <AppShell localLibraryLoader={loader} initialOpenReaderPaperIds={[paper.id]} initialPapers={[paper]}
    modelTransport={window.location.hash === "#literature-guide" ? ({ body, signal }) => fetch("/literature-guide-model", { method: "POST", body, signal }) : undefined} /> : null;
}

export default function PdfHighlightBrowserFixture() {
  if (window.location.hash === "#ai-workbench") return <AppShell localLibraryLoader={loadAiFixture} initialPapers={aiPapers} initialOpenReaderPaperIds={aiPapers.slice(0, 2).map((paper) => paper.id)} />;
  if (window.location.hash === "#library-folders") return <AppShell localLibraryLoader={loadFolderFixture} initialPapers={[]} />;
  if (["#importable", "#literature-guide"].includes(window.location.hash)) return <ImportablePdfBrowserFixture />;
  const previewPaper: Paper = {
    id: "manual-das24a-preview",
    sourcePath: new URL("/manual-preview/das24a.pdf", window.location.origin).href,
    title: "das24a.pdf"
  };
  return <AppShell initialOpenReaderPaperIds={[previewPaper.id]} initialPapers={[previewPaper]}
    modelTransport={window.location.hash === "#ui-improvements" ? async ({ body }) => {
      const request = JSON.parse(body) as { prompt: string };
      if (!request.prompt.includes("第 1 页全文") || !request.prompt.includes("摘要")) {
        throw new Error("Missing quick-ask context in browser test");
      }
      return { ok: true, status: 200, json: async () => ({
        answer: "**紧凑表示**保留了任务所需的信息，同时减少存储与计算开销。",
        execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
      }) };
    } : undefined}
  />;
}
