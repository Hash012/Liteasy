import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportJob } from "../features/import/import.types";
import type { PdfDocumentInfo } from "../features/pdf/pdfDocumentInfo";
import type { NotesItem } from "../features/notes/notes.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { FileStatus, ToolbarAction, WorkspaceSurface, WorkspaceToolbarState } from "../features/workspace/workspaceShell.types";

export function usePdfFileStatus() {
  const [documents, setDocuments] = useState<Record<string, PdfDocumentInfo>>({});
  const onDocumentInfo = useCallback((info: PdfDocumentInfo) => {
    setDocuments((current) => {
      const previous = current[info.paperId];
      if (previous?.sourcePath === info.sourcePath && previous?.pageCount === info.pageCount && previous?.size === info.size) return current;
      return { ...current, [info.paperId]: info };
    });
  }, []);
  return { onDocumentInfo, forPaper: (paper: Paper) => documents[paper.id]?.sourcePath === paper.sourcePath ? documents[paper.id] : undefined };
}

export function paperFileStatus(paper: Paper, job?: ImportJob, metadata?: Pick<FileStatus, "pageCount" | "size">): FileStatus {
  return {
    name: paper.title,
    path: paper.sourcePath,
    type: paper.sourcePath ? "PDF" : undefined,
    ...metadata,
    source: paper.sourcePath
      ? /^https?:/i.test(paper.sourcePath) ? "remote" : "local"
      : paper.libraryReference ? "cloud" : undefined,
    indexState: job?.status === "parsed" ? "indexed"
      : job?.status === "queued" || job?.status === "parsing" ? "indexing"
      : job?.status === "failed" ? "error" : undefined
  };
}

export function noteFileStatus(note?: NotesItem): FileStatus | undefined {
  if (!note || note.unavailable) return undefined;
  return {
    name: note.title,
    path: note.file?.path,
    type: note.file ? /\.canvas$/i.test(note.file.path) ? "Canvas" : "Markdown" : "笔记",
    // Only file-backed notes have a known serialized byte length.
    size: note.file ? new TextEncoder().encode(note.file.text).byteLength : undefined,
    // An external projection timestamp is not the file's modification time.
    modifiedAt: !note.file && note.updatedAt ? new Date(note.updatedAt) : undefined,
    source: note.file ? "local" : undefined
  };
}

export function useWorkspaceShellController(input: {
  surfaces: WorkspaceSurface[];
  layoutActions: ToolbarAction[];
  openSettings: () => void;
}) {
  const [focusedRegion, focusRegion] = useState<string>();
  const previousActive = useRef<Record<string, string>>({});
  const activeSurfaces = input.surfaces.filter((surface) => surface.active);
  const changed = activeSurfaces.filter((surface) => previousActive.current[surface.region] !== surface.id);
  const initial = activeSurfaces.find((surface) => surface.region === "main" && surface.id !== "artifacts")
    ?? activeSurfaces.find((surface) => surface.region === "left") ?? activeSurfaces[0];
  const active = activeSurfaces.find((surface) => surface.region === focusedRegion) ?? initial;
  const activeId = active?.id;
  const latest = useRef(input);
  latest.current = input;
  const [history, setHistory] = useState<{ ids: string[]; index: number }>({ ids: [], index: -1 });
  const navigating = useRef<string>();

  useEffect(() => {
    const hadPrevious = Object.keys(previousActive.current).length > 0;
    previousActive.current = Object.fromEntries(activeSurfaces.map((surface) => [surface.region, surface.id]));
    // New documents opened by a citation or other controller become the context too.
    const opened = changed.find((surface) => surface.dynamic);
    if (hadPrevious && opened && !changed.some((surface) => surface.region === focusedRegion)) {
      focusRegion(opened.region);
    }
  });

  useEffect(() => {
    if (!activeId) return;
    if (navigating.current) {
      if (activeId === navigating.current) navigating.current = undefined;
      return;
    }
    setHistory((current) => current.ids[current.index] === activeId ? current : {
      ids: [...current.ids.slice(0, current.index + 1), activeId].slice(-100),
      index: Math.min(current.index + 1, 99)
    });
  }, [activeId]);

  function historyTarget(direction: -1 | 1) {
    for (let index = history.index + direction; index >= 0 && index < history.ids.length; index += direction) {
      if (history.ids[index] !== activeId && input.surfaces.some((surface) => surface.id === history.ids[index])) return index;
    }
    return -1;
  }
  function navigate(direction: -1 | 1) {
    const index = historyTarget(direction);
    const target = input.surfaces.find((surface) => surface.id === history.ids[index]);
    if (!target) return;
    navigating.current = target.id;
    setHistory((current) => ({ ...current, index }));
    focusRegion(target.region);
    target.onActivate();
  }

  const trackInteraction = useCallback((event: { target: EventTarget | null }) => {
    const region = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-region]")?.dataset.region : undefined;
    if (region) focusRegion(region);
  }, []);
  useEffect(() => {
    // Native capture also follows surfaces rendered through the persistent portal.
    document.addEventListener("pointerdown", trackInteraction, true);
    document.addEventListener("focusin", trackInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", trackInteraction, true);
      document.removeEventListener("focusin", trackInteraction, true);
    };
  }, [trackInteraction]);

  function search() {
    if (!active?.search) return;
    const region = Array.from(document.querySelectorAll<HTMLElement>("[data-region]"))
      .find((element) => element.dataset.region === active.region);
    const label = active.search === "library" ? "搜索文献资源" : active.search === "notes" ? "搜索笔记" : "搜索文档内容";
    const field = region?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (field) { field.focus(); field.select(); }
    else if (active.search === "pdf") region?.querySelector<HTMLButtonElement>('button[aria-label="在文档中搜索"]')?.click();
  }

  const toolbar: WorkspaceToolbarState = {
    title: active?.title ?? "Liteasy",
    canGoBack: historyTarget(-1) !== -1,
    canGoForward: historyTarget(1) !== -1,
    onGoBack: () => navigate(-1),
    onGoForward: () => navigate(1),
    actions: [
      ...(active?.search ? [{ id: "search", label: "搜索", icon: "search" as const, priority: 100, onSelect: search }] : []),
      { id: "layout", label: "布局", icon: "layout", priority: 50, children: input.layoutActions }
    ],
    overflowActions: [{ id: "settings", label: "设置", icon: "settings", onSelect: () => latest.current.openSettings() }]
  };
  return { toolbar, fileStatus: active?.fileStatus, focusRegion, trackInteraction };
}
