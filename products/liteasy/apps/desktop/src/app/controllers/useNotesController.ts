import { useEffect, useMemo, useRef, useState } from "react";
import {
  createObjectStorage,
  subscribeObjectStorage,
} from "../features/objects/objectStorage";
import {
  objectText,
  refOf,
  type ObjectEnvelope,
  type ObjectRef,
} from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import {
  makeObjectTransfer,
  readObjectTransfer,
  writeObjectTransfer,
} from "../features/object-transfer/objectTransfer";
import type { Paper } from "../features/workspace/workspace.types";
import type { PdfAnnotationV2 } from "../features/pdf/pdfAnnotationStorage";
import type { AgentArtifactResult } from "../features/artifacts/artifact.types";
import { artifactAnnotationNotes } from "../features/notes/artifactNotesSource";
import { createNotesRepository } from "../features/notes/notesRepository";
import { loadPdfNotes } from "../features/notes/pdfNotesSource";
import {
  NOTES_REFERENCE_MIME,
  NOTES_SOURCES_CHANGED,
  notifyNotesSourcesChanged,
  type NotesPort,
} from "../features/notes/notesPort";
import {
  DEFAULT_NOTES_FOLDERS,
  NOTES_ROOT,
  notesTargetKey,
  type NotesFolder,
  type NotesItem,
  type NotesReference,
  type NotesTarget,
  type NotesViewModel,
} from "../features/notes/notes.types";

export function useNotesController(input: {
  scopeId: string;
  repository: ObjectRepository;
  visible: boolean;
  getPapers(): Paper[];
  onOpen(): void;
  openObject(ref: ObjectRef): void;
  openAnnotation(paper: Paper, annotation: PdfAnnotationV2): void;
  dragAnnotation?(
    paper: Paper,
    annotation: PdfAnnotationV2,
    data: DataTransfer,
  ): void;
  listArtifacts?(): Promise<AgentArtifactResult[]>;
  openArtifact?(artifactId: string, nodeId?: string): void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const repository = input.repository;
  const notes = useMemo(
    () =>
      createNotesRepository(
        createObjectStorage(input.scopeId, () => latest.current.scopeId),
      ),
    [input.scopeId],
  );
  const [folders, setFolders] = useState<NotesFolder[]>(DEFAULT_NOTES_FOLDERS);
  const [sources, setSources] = useState<NotesItem[]>([]);
  const [references, setReferences] = useState<NotesReference[]>([]);
  const [folderId, setFolderId] = useState(NOTES_ROOT);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const mounted = useRef(true);
  const active = () =>
    mounted.current && latest.current.scopeId === repository.scopeId;
  const fromObject = (
    object: ObjectEnvelope,
    folder = "default/note",
    followLatest = true,
  ): NotesItem => {
    const target: NotesTarget = {
      kind: "object",
      ref: refOf(object),
      followLatest,
    };
    const editable =
      object.kind === "content.note" &&
      object.createdBy.type === "user" &&
      object.content.payload.origin !== "external";
    return {
      key: notesTargetKey(target),
      target,
      object,
      title: object.title || "笔记",
      text: objectText(object),
      source:
        folder === "default/board"
          ? "研究白板"
          : folder === "default/paper"
            ? "论文"
            : folder === "default/artifact"
              ? "生成内容"
              : "笔记",
      defaultFolderId: folder,
      updatedAt: object.updatedAt,
      editable,
      automaticallyListed: editable,
    };
  };
  async function refresh() {
    const generation = ++request.current;
    if (!active()) return;
    setBusy(true);
    try {
      const all: ObjectEnvelope[] = [];
      let cursor: string | undefined;
      do {
        const page = await repository.search("", cursor);
        all.push(...page.objects);
        cursor = page.cursor;
      } while (cursor);
      const boardMembers = new Map<string, string>();
      for (const board of all.filter(
        (object) => object.kind === "workspace.board",
      ))
        for (const placement of await repository.listPlacements(board.objectId))
          boardMembers.set(placement.ref.objectId, board.title);
      const objectMap = new Map(all.map((object) => [object.objectId, object]));
      const byDefault = all
        .filter(
          (object) =>
            object.kind === "content.note" &&
            object.createdBy.type === "user" &&
            object.content.payload.origin !== "external",
        )
        .map((object) => {
          const paperSource = object.provenance.sourceRefs.some((ref) => {
            const source = objectMap.get(ref.objectId);
            return (
              source?.kind === "source.document" ||
              (source?.kind === "content.fragment" &&
                source.content.payload.anchors.some(
                  (anchor) => anchor.type === "pdf",
                ))
            );
          });
          const folder = boardMembers.has(object.objectId)
            ? "default/board"
            : paperSource
              ? "default/paper"
              : "default/note";
          const item = fromObject(object, folder);
          if (boardMembers.has(object.objectId))
            item.source = `研究白板 · ${boardMembers.get(object.objectId)}`;
          return item;
        });
      const [nextFolders, nextReferences, pdfItems, artifacts] =
        await Promise.all([
          notes.listFolders(),
          notes.listReferences(),
          loadPdfNotes(latest.current.getPapers()),
          latest.current.listArtifacts?.() ?? Promise.resolve([]),
        ]);
      const indexed = new Map(
        [...byDefault, ...pdfItems, ...artifactAnnotationNotes(artifacts)].map(
          (item) => [item.key, item],
        ),
      );
      for (const entry of nextReferences) {
        const key = notesTargetKey(entry.target);
        if (indexed.has(key)) continue;
        try {
          if (entry.target.kind !== "object")
            throw new Error("原批注已不在文献库中。");
          const object = entry.target.followLatest
            ? await repository.resolveLatest(entry.target.ref.objectId)
            : await repository.get(entry.target.ref);
          if (object.lifecycle !== "active") throw new Error("原内容已删除。");
          const item = fromObject(
            object,
            object.kind === "artifact.document"
              ? "default/artifact"
              : "default/note",
            Boolean(entry.target.followLatest),
          );
          item.key = key;
          item.target = entry.target;
          item.automaticallyListed = false;
          indexed.set(key, item);
        } catch {
          indexed.set(key, {
            key,
            target: entry.target,
            title: "来源不可用",
            text: "原内容可能已移除或暂不在当前设备。",
            source: "失效引用",
            defaultFolderId: "",
            updatedAt: entry.createdAt,
            editable: false,
            unavailable: true,
          });
        }
      }
      if (!active() || generation !== request.current) return;
      setFolders(nextFolders);
      setReferences(nextReferences);
      setSources([...indexed.values()]);
      setError("");
    } catch (e) {
      if (active() && generation === request.current)
        setError((e as Error).message);
    } finally {
      if (active() && generation === request.current) setBusy(false);
    }
  }
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    setSources([]);
    setReferences([]);
    setFolders(DEFAULT_NOTES_FOLDERS);
    setFolderId(NOTES_ROOT);
    setQuery("");
    setSelectedKey("");
    setError("");
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [notes]);
  useEffect(() => {
    if (!input.visible) return;
    void refreshRef.current();
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshRef.current(), 30);
    };
    const unsubscribe = subscribeObjectStorage(input.scopeId, changed);
    window.addEventListener(NOTES_SOURCES_CHANGED, changed);
    window.addEventListener("focus", changed);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener(NOTES_SOURCES_CHANGED, changed);
      window.removeEventListener("focus", changed);
    };
  }, [input.visible, input.scopeId]);
  async function perform(action: () => Promise<void>) {
    if (!active()) throw new Error("账号已切换。");
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      if (active()) setError((e as Error).message);
      throw e;
    }
  }
  async function collect(target: NotesTarget, destination?: string) {
    await perform(async () => {
      let folder = destination ?? "default/artifact";
      let normalized = target;
      if (target.kind === "object") {
        const object = await repository.get(target.ref);
        const userNote =
          object.kind === "content.note" &&
          object.createdBy.type === "user" &&
          object.content.payload.origin !== "external";
        normalized = { ...target, followLatest: userNote };
        if (!destination && userNote) folder = "default/note";
      } else if (target.kind === "pdf-annotation") {
        const match = (await loadPdfNotes(latest.current.getPapers())).find(
          (item) => item.key === notesTargetKey(target),
        );
        if (!match) throw new Error("原批注已不可用。");
        if (!destination) folder = "default/paper";
      } else {
        const match = artifactAnnotationNotes(
          (await latest.current.listArtifacts?.()) ?? [],
        ).find((item) => item.key === notesTargetKey(target));
        if (!match) throw new Error("原批注已不可用。");
        if (!destination) folder = "default/artifact";
      }
      await notes.collect(normalized, folder);
    });
  }
  const port: NotesPort = {
    collect,
    notifySourcesChanged: notifyNotesSourcesChanged,
    open: () => latest.current.onOpen(),
  };
  const folderMatches = (itemFolder: string) => {
    if (folderId === NOTES_ROOT) return true;
    let candidate = itemFolder;
    while (candidate && candidate !== NOTES_ROOT) {
      if (candidate === folderId) return true;
      candidate =
        folders.find((folder) => folder.folderId === candidate)?.parentId ?? "";
    }
    return false;
  };
  const visibleItems = new Map<string, NotesItem>();
  for (const item of sources)
    if (item.automaticallyListed && folderMatches(item.defaultFolderId))
      visibleItems.set(item.key, item);
  for (const entry of references) {
    if (!folderMatches(entry.folderId)) continue;
    const item = sources.find(
      (source) => source.key === notesTargetKey(entry.target),
    );
    if (item)
      visibleItems.set(item.key, {
        ...item,
        // Parent views aggregate descendants. Only the current directory's own
        // entry may be removed here; never choose a descendant reference by order.
        entryId:
          entry.folderId === folderId
            ? entry.entryId
            : visibleItems.get(item.key)?.entryId,
      });
  }
  const items = [...visibleItems.values()]
    .filter((item) =>
      `${item.title}\n${item.text}\n${item.source}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const model: NotesViewModel = {
    folders,
    folderId,
    items,
    query,
    busy,
    error,
    selected: items.find((item) => item.key === selectedKey),
    selectFolder: (id) => {
      setFolderId(id);
      setSelectedKey("");
    },
    selectItem: (item) => setSelectedKey(item.key),
    search: setQuery,
    refresh,
    createFolder: (name) =>
      perform(async () => {
        const folder = await notes.createFolder(folderId, name);
        setFolderId(folder.folderId);
      }),
    removeFolder: () =>
      perform(async () => {
        const parent =
          folders.find((folder) => folder.folderId === folderId)?.parentId ??
          NOTES_ROOT;
        await notes.removeFolder(folderId);
        setFolderId(parent);
      }),
    createNote: (text) =>
      perform(async () => {
        if (!text.trim()) throw new Error("请输入笔记内容。");
        const object = await repository.create({
          kind: "content.note",
          title: text.trim().split("\n")[0].slice(0, 100),
          content: {
            schema: "liteasy.note/v1",
            payload: { text, origin: "user" },
          },
        });
        if (folderId !== NOTES_ROOT && folderId !== "default/note")
          await notes.collect(
            { kind: "object", ref: refOf(object), followLatest: true },
            folderId,
          );
        setSelectedKey(
          notesTargetKey({
            kind: "object",
            ref: refOf(object),
            followLatest: true,
          }),
        );
      }),
    editNote: (item, text) =>
      perform(async () => {
        if (!item.editable || !item.object)
          throw new Error("请在来源页面编辑此内容。");
        await repository.editNote(
          refOf(item.object),
          text,
          text.trim().split("\n")[0].slice(0, 100) || "笔记",
        );
      }),
    collect: (item, destination) => collect(item.target, destination),
    removeReference: (item) =>
      perform(async () => {
        if (!item.entryId)
          throw new Error("默认目录映射到原内容；请在来源页面管理。");
        await notes.removeReference(item.entryId);
        setSelectedKey("");
      }),
    openSource(item) {
      if (item.paper && item.annotation)
        latest.current.openAnnotation(item.paper, item.annotation);
      else if (item.artifactId)
        latest.current.openArtifact?.(item.artifactId, item.nodeId);
      else if (
        item.object?.kind === "artifact.document" &&
        item.object.content.payload.legacyArtifactId &&
        latest.current.openArtifact
      )
        latest.current.openArtifact(
          item.object.content.payload.legacyArtifactId,
          item.target.kind === "object"
            ? item.target.ref.selectorId
            : undefined,
        );
      else if (item.object) latest.current.openObject(refOf(item.object));
    },
    drag(item, data) {
      data.setData(NOTES_REFERENCE_MIME, JSON.stringify(item.target));
      if (item.paper && item.annotation)
        latest.current.dragAnnotation?.(item.paper, item.annotation, data);
      else if (item.object)
        writeObjectTransfer(
          data,
          makeObjectTransfer([refOf(item.object)], item.text),
        );
      data.effectAllowed = "copy";
    },
    async drop(data, destination) {
      const note = data.getData(NOTES_REFERENCE_MIME);
      if (note) {
        await collect(JSON.parse(note) as NotesTarget, destination);
        return;
      }
      const transfer = readObjectTransfer(data);
      if (transfer)
        for (const ref of transfer.refs)
          await collect({ kind: "object", ref }, destination);
    },
  };
  return { model, port, refresh };
}
