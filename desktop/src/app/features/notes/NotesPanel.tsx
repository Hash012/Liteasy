import { useState, useEffect } from "react";
import type { NoteGroup, Note } from "./notes.types";

type NotesPanelProps = {
  papers: Array<{ id: string; title: string }>;
  notesStore: ReturnType<typeof import("./notes.store").createNotesStore>;
  onJumpToNote: (paperId: string, filePath: string, pageNo: number) => void;
  paperPaths: Map<string, string>;
  refreshKey?: number; // 外部触发刷新
};

export function NotesPanel({ papers, notesStore, onJumpToNote, paperPaths, refreshKey }: NotesPanelProps) {
  const [groups, setGroups] = useState<Map<string, NoteGroup[]>>(new Map());
  const [notes, setNotes] = useState<Map<string, Note[]>>(new Map());
  const [expandedPapers, setExpandedPapers] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState<Record<string, string>>({});

  const loadData = async () => {
    const allGroups = new Map<string, NoteGroup[]>();
    const allNotes = new Map<string, Note[]>();
    for (const p of papers) {
      const gs = await notesStore.loadGroupsForPaper(p.id);
      allGroups.set(p.id, gs);
      const ns = await notesStore.loadNotesForPaper(p.id);
      allNotes.set(p.id, ns);
    }
    setGroups(allGroups);
    setNotes(allNotes);
  };

  useEffect(() => { loadData(); }, [papers, refreshKey]);

  const togglePaper = (id: string) => {
    const next = new Set(expandedPapers);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedPapers(next);
  };

  const toggleGroup = (id: string) => {
    const next = new Set(expandedGroups);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedGroups(next);
  };

  const handleAddGroup = async (paperId: string) => {
    const name = newGroupName[paperId]?.trim();
    if (!name) return;
    await notesStore.addGroup(paperId, name);
    setNewGroupName(prev => ({ ...prev, [paperId]: "" }));
    await loadData();
  };

  const handleDeleteGroup = async (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    if (!confirm("确定要删除此分组及其所有笔记吗？")) return;
    await notesStore.deleteGroup(groupId);
    await loadData();
  };

  const handleDeleteNote = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    await notesStore.deleteNote(noteId);
    await loadData();
  };

  return (
    <div className="notes-panel">
      {papers.map(paper => (
        <div key={paper.id} className="notes-paper-group">
          <div className="notes-paper-header" onClick={() => togglePaper(paper.id)}>
            <span>{expandedPapers.has(paper.id) ? "▾" : "▸"}</span>
            <span>📄 {paper.title}</span>
            <span style={{ color: "#aaa", fontSize: 11, marginLeft: "auto" }}>
              {(groups.get(paper.id) || []).length} 组
            </span>
          </div>
          {expandedPapers.has(paper.id) && (
            <div className="notes-group-list">
              {(groups.get(paper.id) || []).map(group => (
                <div key={group.id} className="notes-group-item">
                  <div className="notes-group-header">
                    <span style={{ cursor: "pointer", flex: 1, display: "flex", gap: 6 }}
                      onClick={() => toggleGroup(group.id)}>
                      <span>{expandedGroups.has(group.id) ? "▾" : "▸"}</span>
                      <span>📁 {group.name}</span>
                      <span style={{ color: "#aaa", fontSize: 10 }}>
                        ({(notes.get(paper.id) || []).filter(n => n.groupId === group.id).length})
                      </span>
                    </span>
                    <button className="notes-delete-btn"
                      onClick={(e) => handleDeleteGroup(e, group.id)}
                      title="删除分组">✕</button>
                  </div>
                  {expandedGroups.has(group.id) && (
                    <div className="notes-note-list">
                      {(notes.get(paper.id) || [])
                        .filter(n => n.groupId === group.id)
                        .map(note => (
                          <div key={note.id} className="notes-note-item"
                            onClick={() => {
                              const fp = paperPaths.get(paper.id);
                              if (fp) onJumpToNote(paper.id, fp, note.pageNo);
                            }}>
                            <div className="notes-note-header">
                              <div className="notes-note-page">p.{note.pageNo}</div>
                              <button className="notes-delete-btn"
                                onClick={(e) => handleDeleteNote(e, note.id)}
                                title="删除笔记">✕</button>
                            </div>
                            <div className="notes-note-text">{note.selectedText.slice(0, 80)}{note.selectedText.length > 80 ? "..." : ""}</div>
                            {note.noteText && (
                              <div className="notes-note-comment">💬 {note.noteText.slice(0, 80)}{note.noteText.length > 80 ? "..." : ""}</div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="notes-new-group">
                <input
                  className="notes-new-group-input"
                  placeholder="新建分组..."
                  value={newGroupName[paper.id] || ""}
                  onChange={e => setNewGroupName(prev => ({ ...prev, [paper.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") handleAddGroup(paper.id); }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
