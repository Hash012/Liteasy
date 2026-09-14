import type { NoteFileChange, NoteFileEntry, NoteFileMount, NoteFileService } from "./noteFileService";

export type CatalogFile = NoteFileEntry & { location: string };

/** Metadata only. Reading file bodies belongs to the user's selected context operation. */
export function createNoteFileCatalogIndex(input: {
  files: Pick<NoteFileService, "listMounts" | "listEntries">;
  onChange(files: CatalogFile[]): void;
}) {
  const mounts = new Map<string, NoteFileMount>();
  const entries = new Map<string, Map<string, CatalogFile>>();
  const pendingChanges = new Map<string, { entry: NoteFileEntry; sequence: number }>();
  const scanning = new Map<string, Promise<void>>();
  let sequence = 0;
  let active = true;
  let published: CatalogFile[] = [];
  let publishPending = false;
  let refreshPending: Promise<void> | undefined;
  let refreshAgain = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function project(entry: NoteFileEntry, mount: NoteFileMount, previous?: CatalogFile): CatalogFile {
    const location = mount.kind === "file" ? mount.location : `${mount.location}/${entry.path}`;
    return previous?.location === location && previous.name === entry.name && previous.kind === entry.kind
      ? previous : { ...entry, location };
  }

  function publish() {
    if (publishPending || !active) return;
    publishPending = true;
    queueMicrotask(() => {
      publishPending = false;
      if (!active) return;
      const next = [...entries.values()].flatMap((group) => [...group.values()]);
      if (next.length === published.length && next.every((entry, index) => entry === published[index])) return;
      published = next;
      input.onChange(next);
    });
  }

  async function scanMount(mount: NoteFileMount): Promise<void> {
    const running = scanning.get(mount.id);
    if (running) return running;
    const started = sequence;
    const run = (async () => {
      try {
        const listed = await input.files.listEntries(mount.id);
        if (!active || !mounts.has(mount.id)) return;
        const previous = entries.get(mount.id);
        const next = new Map<string, CatalogFile>();
        for (const entry of listed) {
          if (entry.kind === "file" && /\.(md|markdown|canvas)$/i.test(entry.name))
            next.set(entry.path, project(entry, mount, previous?.get(entry.path)));
        }
        // A write completing during a scan must not disappear behind its older listing.
        for (const [key, change] of pendingChanges) {
          if (change.entry.mountId !== mount.id) continue;
          if (change.sequence > started) next.set(change.entry.path,
            project(change.entry, mount, previous?.get(change.entry.path)));
          else pendingChanges.delete(key);
        }
        entries.set(mount.id, next);
        publish();
      } catch {
        // Retain a previously available index during a transient disconnect.
        // Selection still reads and validates the current file before attaching it.
      }
    })();
    scanning.set(mount.id, run);
    try { await run; } finally { if (scanning.get(mount.id) === run) scanning.delete(mount.id); }
  }

  function refresh(): Promise<void> {
    if (refreshPending) return refreshPending;
    if (!active) return Promise.resolve();
    const run = (async () => {
      try {
        const listed = await input.files.listMounts();
        if (!active) return;
        const current = new Set(listed.map((mount) => mount.id));
        for (const id of mounts.keys()) if (!current.has(id)) { mounts.delete(id); entries.delete(id); }
        for (const mount of listed) mounts.set(mount.id, mount);
        // Bound host calls when many directories are mounted.
        for (let offset = 0; offset < listed.length && active; offset += 4)
          await Promise.all(listed.slice(offset, offset + 4).map(scanMount));
        publish();
      } catch { /* The next focus or mount update retries unavailable storage. */ }
    })();
    refreshPending = run.finally(() => {
      refreshPending = undefined;
      if (refreshAgain && active) { refreshAgain = false; requestRefresh(); }
    });
    return refreshPending;
  }

  function requestRefresh() {
    if (!active || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (refreshPending) refreshAgain = true;
      else void refresh();
    }, 100);
  }

  function change(change?: NoteFileChange) {
    if (!active) return;
    if (!change) { requestRefresh(); return; }
    if (change.kind === "directory") return;
    if (change.kind === "mount") {
      mounts.set(change.mount.id, change.mount);
      // Re-selecting an existing folder also restores its grant and fresh listing.
      void scanMount(change.mount);
      return;
    }
    const entry = change.entry;
    if (!/\.(md|markdown|canvas)$/i.test(entry.name)) return;
    pendingChanges.set(`${entry.mountId}\0${entry.path}`, { entry, sequence: ++sequence });
    const mount = mounts.get(entry.mountId);
    if (!mount) { requestRefresh(); return; }
    const group = entries.get(mount.id) ?? new Map<string, CatalogFile>();
    const previous = group.get(entry.path);
    const next = project(entry, mount, previous);
    if (next === previous) return;
    group.set(entry.path, next);
    entries.set(mount.id, group);
    publish();
  }

  return {
    change, refresh, requestRefresh,
    dispose() { active = false; if (refreshTimer) clearTimeout(refreshTimer); },
  };
}
