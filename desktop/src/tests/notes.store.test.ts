import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.reject(new Error("Tauri not available in test")),
}));

describe("notes store", () => {
  it("adds and retrieves groups for a paper", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "关键公式");
    expect(g.name).toBe("关键公式");
    expect(g.paperId).toBe("paper-1");

    const local = store.getLocalGroups("paper-1");
    expect(local.length).toBe(1);
    expect(local[0].name).toBe("关键公式");
  });

  it("adds and retrieves notes for a group", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "关键公式");
    const n = await store.addNote(g.id, "paper-1", "selected text", "my note", 3, null);

    expect(n.selectedText).toBe("selected text");
    expect(n.noteText).toBe("my note");
    expect(n.pageNo).toBe(3);
    expect(n.groupId).toBe(g.id);

    const local = store.getLocalNotes(g.id);
    expect(local.length).toBe(1);
    expect(local[0].id).toBe(n.id);
  });

  it("deletes a group", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "临时分组");
    expect(store.getLocalGroups("paper-1").length).toBe(1);
    await store.deleteGroup(g.id);
    expect(store.getLocalGroups("paper-1").length).toBe(0);
  });

  it("deletes a note", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "分组");
    const n = await store.addNote(g.id, "paper-1", "text", "comment", 1, null);
    expect(store.getLocalNotes(g.id).length).toBe(1);
    await store.deleteNote(n.id);
    expect(store.getLocalNotes(g.id).length).toBe(0);
  });
});
