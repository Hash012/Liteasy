import { useEffect, useRef, useState } from "react";
import { refOf, type ObjectEnvelope } from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { PaperProjectRepository } from "../features/paper-projects/paperProjectRepository";
import type { LibraryPaperChildItem } from "../features/library/LibraryPane";
import type { Paper } from "../features/workspace/workspace.types";
import { subscribeObjectStorage } from "../features/objects/objectStorage";

type NoteSession = { object: ObjectEnvelope; draft: string; saved: string; projectId: string; assetId: string };
export function usePaperAttachmentController(input: { repository: ObjectRepository; projects: PaperProjectRepository;
  openEditor(): void; openBoard(object: ObjectEnvelope): Promise<void> }) {
  const latest = useRef(input); latest.current = input;
  const [sessions, setSessions] = useState<Record<string, NoteSession>>({});
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = input.repository.scopeId;
  const request = useRef(0);
  useEffect(() => { request.current += 1; setSessions({}); setSelected(""); setError(""); setBusy(false); }, [scope]);
  const active = () => latest.current.repository.scopeId === scope;
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribeObjectStorage(scope, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          for (const session of Object.values(sessionsRef.current)) {
            const object = await input.repository.resolveLatest(session.object.objectId);
            if (disposed || !active()) return;
            if (object.kind !== "content.note" || object.revision === session.object.revision) continue;
            setSessions((current) => {
              const item = current[object.objectId];
              if (!item || item.object.revision !== session.object.revision || item.draft !== item.saved) return current;
              return { ...current, [object.objectId]: { ...item, object, saved: object.content.payload.text, draft: object.content.payload.text } };
            });
          }
        })().catch(() => undefined);
      }, 100);
    });
    return () => { disposed = true; clearTimeout(timer); stop(); };
  }, [input.repository, scope]);
  async function open(item: LibraryPaperChildItem, paper: Paper) {
    if (!item.objectId) return;
    const ticket = ++request.current;
    try {
      const object = await input.repository.resolveLatest(item.objectId);
      if (!active() || ticket !== request.current) return;
      if (object.kind === "workspace.board") { await input.openBoard(object); return; }
      if (object.kind !== "content.note") return;
      const project = await input.projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
      if (!active() || ticket !== request.current) return;
      setSessions((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([, note]) => note.draft !== note.saved)), [object.objectId]: current[object.objectId]?.draft !== current[object.objectId]?.saved ? current[object.objectId] : {
        object, draft: object.content.payload.text, saved: object.content.payload.text, projectId: project.projectId, assetId: item.id,
      } }));
      setSelected(object.objectId); setError(""); input.openEditor();
    } catch (failure) { if (active()) setError(String(failure)); throw failure; }
  }
  async function create(paper: Paper, kind: "note" | "board", title: string) {
    const project = await input.projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
    const asset = kind === "note" ? await input.projects.createNote(project.projectId, `# ${title}\n\n`, title)
      : await input.projects.createBoard(project.projectId, title);
    if (active()) await open({ id: asset.assetId, kind, label: asset.title, objectId: asset.ref!.objectId }, paper);
  }
  const session = sessions[selected];
  async function save() {
    if (!session || busy) return;
    setBusy(true); setError("");
    try {
      const note = await input.repository.editNote(refOf(session.object), session.draft);
      await input.projects.addAsset(session.projectId, { assetId: session.assetId, kind: "note", role: "derived", title: note.title, ref: refOf(note) });
      if (active()) setSessions((current) => ({ ...current, [note.objectId]: { ...current[note.objectId], object: note, saved: session.draft } }));
    } catch (failure) { if (active()) setError(`${String(failure)}。草稿仍保留，请复制后再重新载入。`); }
    finally { if (active()) setBusy(false); }
  }
  async function reload() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const object = await input.repository.resolveLatest(session.object.objectId);
      if (active() && object.kind === "content.note") setSessions((current) => ({ ...current, [object.objectId]: { ...session, object, draft: object.content.payload.text, saved: object.content.payload.text } }));
      if (active()) setError("");
    } catch (failure) { if (active()) setError(String(failure)); }
    finally { if (active()) setBusy(false); }
  }
  return { open, create, session, busy, error, save, reload, select: setSelected,
    drafts: Object.values(sessions).filter((item) => item.draft !== item.saved),
    setDraft: (draft: string) => setSessions((current) => ({ ...current, [selected]: { ...current[selected], draft } })),
  };
}
export type PaperAttachmentController = ReturnType<typeof usePaperAttachmentController>;
