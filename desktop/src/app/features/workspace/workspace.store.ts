import type { Paper, PaperContent, WorkspaceState } from "./workspace.types";
import { invoke } from "@tauri-apps/api/core";

export function createWorkspaceStore() {
  const state: WorkspaceState = {
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false,
    activePaperId: undefined,
  };

  async function persistPaper(paper: Paper) {
    try {
      await invoke("db_save_paper", {
        id: paper.id,
        title: paper.title,
        filePath: paper.filePath,
        content: paper.content?.fullText ?? "",
        pageCount: paper.content?.pageCount ?? 0,
        importedAt: paper.content?.importedAt ?? new Date().toISOString(),
      });
    } catch {}
  }

  return {
    async initFromDb() {
      try {
        const rows = await invoke<Array<{
          id: string; title: string; filePath: string;
          content: string; pageCount: number; importedAt: string;
        }>>("db_load_papers");
        // Clear to prevent duplicates from React 18 StrictMode double-mount
        state.papers.length = 0;
        for (const r of rows) {
          state.papers.push({
            id: r.id,
            title: r.title,
            filePath: r.filePath,
            content: {
              fullText: r.content,
              pageCount: r.pageCount,
              importedAt: r.importedAt,
            },
          });
        }
      } catch { /* Tauri not available */ }
    },
    addPaper(paper: Paper) {
      state.papers.push(paper);
      persistPaper(paper).catch(() => {});
    },
    getPaper(id: string): Paper | undefined {
      return state.papers.find((p) => p.id === id);
    },
    getPaperByPath(filePath: string): Paper | undefined {
      return state.papers.find((p) => p.filePath === filePath);
    },
    async deletePaper(id: string) {
      const idx = state.papers.findIndex((p) => p.id === id);
      if (idx !== -1) state.papers.splice(idx, 1);
      if (state.activePaperId === id) state.activePaperId = undefined;
      state.selectedPaperIds = state.selectedPaperIds.filter(sid => sid !== id);
      try { await invoke("db_delete_paper", { id }); } catch {}
    },
    setPaperContent(id: string, content: PaperContent) {
      const paper = state.papers.find((p) => p.id === id);
      if (paper) {
        paper.content = content;
      }
    },
    setActivePaper(id: string) {
      if (state.papers.some((p) => p.id === id)) {
        state.activePaperId = id;
      }
    },
    toggleSelection(id: string) {
      if (state.selectionLocked) {
        return;
      }

      state.selectedPaperIds = state.selectedPaperIds.includes(id)
        ? state.selectedPaperIds.filter((item) => item !== id)
        : [...state.selectedPaperIds, id];
    },
    lockSelection() {
      state.selectionLocked = true;
    },
    unlockSelection() {
      state.selectionLocked = false;
    },
    getState() {
      return state;
    },
  };
}
