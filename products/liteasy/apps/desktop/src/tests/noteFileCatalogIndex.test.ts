import { afterEach, expect, test, vi } from "vitest";
import { createNoteFileCatalogIndex, type CatalogFile } from "../app/features/note-files/noteFileCatalogIndex";
import type { NoteFileEntry, NoteFileMount } from "../app/features/note-files/noteFileService";

afterEach(() => vi.useRealTimers());
const mount = (id: string): NoteFileMount => ({ id, name: id, location: `/vaults/${id}`, kind: "directory" });
const file = (mountId: string, path: string): NoteFileEntry => ({ mountId, path, name: path.split("/").at(-1)!, kind: "file" });

test("updates a 20,000-file catalog without rescanning any mount on a burst of writes", async () => {
  const mounts = Array.from({ length: 20 }, (_, index) => mount(`vault-${index}`));
  const listMounts = vi.fn(async () => mounts);
  const listEntries = vi.fn(async (id: string) => Array.from({ length: 1000 }, (_, index) => file(id, `research/topic-${index}/note.md`)));
  let catalog: CatalogFile[] = [];
  const changed = vi.fn((next: CatalogFile[]) => { catalog = next; });
  const index = createNoteFileCatalogIndex({ files: { listMounts, listEntries }, onChange: changed });
  await index.refresh();
  expect(catalog).toHaveLength(20_000);
  const existing = catalog.find((item) => item.mountId === "vault-9" && item.path === "research/topic-1/note.md");
  listMounts.mockClear(); listEntries.mockClear(); changed.mockClear();
  const started = performance.now();
  for (let iteration = 0; iteration < 500; iteration++) {
    index.change({ kind: "file", entry: file("vault-9", "research/topic-1/note.md") });
    index.change({ kind: "directory", mountId: "vault-9", path: "research/new" });
  }
  await Promise.resolve();
  expect(changed).not.toHaveBeenCalled();
  index.change({ kind: "file", entry: file("vault-9", "research/new/added.md") });
  index.change({ kind: "file", entry: file("vault-9", "research/new/added.md") });
  await Promise.resolve();
  expect(catalog).toHaveLength(20_001);
  expect(changed).toHaveBeenCalledOnce();
  expect(catalog).toContain(existing);
  expect(listEntries).not.toHaveBeenCalled();
  expect(listMounts).not.toHaveBeenCalled();
  console.info(`20,000-file catalog: 1,002 incremental events ${(performance.now() - started).toFixed(1)} ms, 0 filesystem scans`);
  index.dispose();
});

test("scans only the added mount and coalesces repeated focus refreshes", async () => {
  const mounts = [mount("first")];
  const files = { listMounts: vi.fn(async () => [...mounts]), listEntries: vi.fn(async (id: string) => [file(id, "one.md")]) };
  const changed = vi.fn();
  const index = createNoteFileCatalogIndex({ files, onChange: changed });
  await index.refresh();
  files.listEntries.mockClear(); files.listMounts.mockClear();
  mounts.push(mount("second"));
  index.change({ kind: "mount", mount: mounts[1] });
  await vi.waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toHaveLength(2));
  expect(files.listMounts).not.toHaveBeenCalled();
  expect(files.listEntries.mock.calls).toEqual([["second"]]);
  files.listEntries.mockClear();
  vi.useFakeTimers();
  for (let iteration = 0; iteration < 100; iteration++) index.requestRefresh();
  await vi.advanceTimersByTimeAsync(100);
  expect(files.listMounts).toHaveBeenCalledOnce();
  expect(files.listEntries).toHaveBeenCalledTimes(2);
  index.dispose();
});

test("a write during an older scan stays visible and a later refresh notices external deletion", async () => {
  let resolve!: (entries: NoteFileEntry[]) => void;
  const files = {
    listMounts: vi.fn(async () => [mount("vault")]),
    listEntries: vi.fn(() => new Promise<NoteFileEntry[]>((done) => { resolve = done; })),
  };
  let catalog: CatalogFile[] = [];
  const index = createNoteFileCatalogIndex({ files, onChange: (next) => { catalog = next; } });
  const scanning = index.refresh();
  await vi.waitFor(() => expect(files.listEntries).toHaveBeenCalledOnce());
  index.change({ kind: "file", entry: file("vault", "new.md") });
  resolve([]);
  await scanning;
  expect(catalog.map((item) => item.path)).toEqual(["new.md"]);
  files.listEntries.mockImplementation(async () => []);
  await index.refresh();
  expect(catalog).toEqual([]);
  index.dispose();
});

test("deduplicates paths, retains a disconnected index, and ignores completed scans after disposal", async () => {
  const files = { listMounts: vi.fn(async () => [mount("vault")]), listEntries: vi.fn(async () => [file("vault", "one.md"), file("vault", "one.md")]) };
  const changed = vi.fn();
  const index = createNoteFileCatalogIndex({ files, onChange: changed });
  await index.refresh();
  expect(changed.mock.calls.at(-1)?.[0]).toHaveLength(1);
  changed.mockClear();
  files.listEntries.mockRejectedValueOnce(new Error("offline"));
  await index.refresh();
  expect(changed).not.toHaveBeenCalled();
  const refreshing = index.refresh();
  index.dispose();
  await refreshing;
  expect(changed).not.toHaveBeenCalled();
});


test("uses the granted absolute location for individually mounted files", async () => {
  const changed = vi.fn();
  const index = createNoteFileCatalogIndex({ files: {
    listMounts: async () => [{ id: "one-file", kind: "file", name: "note.md", location: "D:/Research/note.md" }],
    listEntries: async () => [file("one-file", "note.md")],
  }, onChange: changed });
  await index.refresh();
  expect(changed.mock.calls.at(-1)?.[0][0].location).toBe("D:/Research/note.md");
  index.dispose();
});
