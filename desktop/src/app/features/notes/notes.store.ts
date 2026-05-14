import { invoke } from "@tauri-apps/api/core";
import type { NoteGroup, Note } from "./notes.types";

export function createNotesStore() {
  const groups: NoteGroup[] = [];
  const notes: Note[] = [];

  return {
    async loadGroupsForPaper(paperId: string): Promise<NoteGroup[]> {
      try {
        const rows = await invoke<NoteGroup[]>("db_load_note_groups", { paperId });
        // Sync into in-memory store so annotation modal can find them
        for (const g of rows) {
          if (!groups.some(lg => lg.id === g.id)) {
            groups.push(g);
          }
        }
        return rows;
      } catch {
        return groups.filter(g => g.paperId === paperId);
      }
    },

    async addGroup(paperId: string, name: string): Promise<NoteGroup> {
      const group: NoteGroup = {
        id: `group-${Date.now()}`,
        paperId,
        name,
        sortOrder: groups.filter(g => g.paperId === paperId).length,
        createdAt: new Date().toISOString(),
      };
      groups.push(group);
      try {
        await invoke("db_save_note_group", {
          id: group.id, paperId, name, sortOrder: group.sortOrder,
          createdAt: group.createdAt,
        });
      } catch { /* offline fallback */ }
      return group;
    },

    async deleteGroup(id: string): Promise<void> {
      const idx = groups.findIndex(g => g.id === id);
      if (idx !== -1) groups.splice(idx, 1);
      try { await invoke("db_delete_note_group", { id }); } catch {}
    },

    async addNote(groupId: string, paperId: string, selectedText: string,
      noteText: string, pageNo: number, bbox: string | null): Promise<Note> {
      const note: Note = {
        id: `note-${Date.now()}`,
        groupId, paperId, selectedText, noteText, pageNo, bbox,
        color: "#ffeb3b",
        createdAt: new Date().toISOString(),
      };
      notes.push(note);
      try {
        await invoke("db_save_note", {
          id: note.id, groupId, paperId, selectedText, noteText,
          pageNo, bbox, color: note.color, createdAt: note.createdAt,
        });
      } catch {}
      return note;
    },

    async loadNotesForPaper(paperId: string): Promise<Note[]> {
      try {
        return await invoke<Note[]>("db_load_notes", { paperId, groupId: null });
      } catch {
        return notes.filter(n => n.paperId === paperId);
      }
    },

    async deleteNote(id: string): Promise<void> {
      const idx = notes.findIndex(n => n.id === id);
      if (idx !== -1) notes.splice(idx, 1);
      try { await invoke("db_delete_note", { id }); } catch {}
    },

    getLocalGroups(paperId: string): NoteGroup[] {
      return groups.filter(g => g.paperId === paperId);
    },

    getLocalNotes(groupId: string): Note[] {
      return notes.filter(n => n.groupId === groupId);
    },
  };
}
