import { useEffect, useMemo, useRef, useState } from "react";
import { LocalFileOperationsPanel, type LocalFileOperationsView } from "../features/local-file-operations/LocalFileOperationsPanel";
import { createLocalCopyRunner, createLocalFileOperationsService, type LocalCopyTask } from "../features/local-file-operations/localFileOperations";
import { createNoteFileService, type NoteFileEntry, type NoteFileMount } from "../features/note-files/noteFileService";

/** Mount with key={scope}: task previews and selections are principal-local. */
export function LocalFileOperationsTool({ scope, currentScope }: { scope: string; currentScope: () => string }) {
  const current = useRef(currentScope);
  current.current = currentScope;
  const service = useMemo(() => createLocalFileOperationsService(scope, () => current.current()), [scope]);
  const notes = useMemo(() => createNoteFileService(scope, () => current.current()), [scope]);
  const runner = useMemo(() => createLocalCopyRunner(service), [service]);
  const active = useRef(true);
  const inFlight = useRef(false);
  const [source, setSource] = useState<NoteFileMount | null>(null);
  const [destination, setDestination] = useState<NoteFileMount | null>(null);
  const [entries, setEntries] = useState<NoteFileEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [task, setTask] = useState<LocalCopyTask | null>(null);
  const [history, setHistory] = useState<LocalCopyTask[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmation, setConfirmation] = useState<LocalFileOperationsView["confirmation"]>(null);
  const alive = () => active.current && scope === current.current();
  useEffect(() => {
    active.current = true;
    if (service.available) void service.list().then((tasks) => { if (alive()) setHistory(tasks); }, (failure: Error) => { if (alive()) setError(failure.message); });
    return () => { active.current = false; runner.cancel(); };
  }, [service, runner]);
  const publish = (next: LocalCopyTask) => {
    if (!alive()) return;
    setTask(next);
    setHistory((existing) => [next, ...existing.filter((entry) => entry.id !== next.id)].slice(0, 50));
  };
  const perform = async (operation: () => Promise<void>) => {
    if (inFlight.current || !alive()) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (failure) { if (alive()) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { inFlight.current = false; if (alive()) { setBusy(false); setRunning(false); } }
  };
  const model: LocalFileOperationsView = {
    available: service.available, busy, running, error, source, destination, entries, selected, task, history, confirmation,
    chooseSource: () => { void perform(async () => {
      const mount = await notes.chooseFolder();
      if (!mount || !alive()) return;
      const listed = await notes.listEntries(mount.id);
      if (!alive()) return;
      setSource(mount); setEntries(listed.filter((entry) => entry.kind === "file" && /\.(md|markdown|canvas)$/i.test(entry.path)));
      setSelected([]); setConfirmation(null);
    }); },
    chooseDestination: () => { void perform(async () => {
      const mount = await notes.chooseFolder();
      if (mount && alive()) { setDestination(mount); setConfirmation(null); }
    }); },
    select: (path, checked) => {
      if (busy) return;
      setSelected((previous) => checked ? [...previous.filter((value) => value !== path), path].slice(0, 100) : previous.filter((value) => value !== path));
      setConfirmation(null);
    },
    preview: () => { void perform(async () => {
      if (!source || !destination || !selected.length) return;
      publish(await service.plan({ sourceMountId: source.id, destinationMountId: destination.id, paths: selected, idempotencyKey: crypto.randomUUID() }));
      if (alive()) setConfirmation(null);
    }); },
    open: (previous) => { void perform(async () => { publish(await service.command("get", previous)); if (alive()) setConfirmation(null); }); },
    requestConfirmation: setConfirmation,
    dismissConfirmation: () => setConfirmation(null),
    confirm: () => { void perform(async () => {
      if (!task || !confirmation) return;
      setRunning(true);
      const start = confirmation === "undo" ? "confirmUndo" : confirmation === "retry" ? "retry" : "confirm";
      setConfirmation(null);
      await runner.run(task, start, publish);
    }); },
    cancel: () => runner.cancel(),
  };
  return <LocalFileOperationsPanel model={model} />;
}
