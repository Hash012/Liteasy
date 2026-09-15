import { formatPaperAnchorText } from "../features/paper-anchors/paperAnchorEntity";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createObjectStorage,
  subscribeObjectStorage,
} from "../features/objects/objectStorage";
import {
  objectLink,
  objectText,
  refOf,
  type ObjectEnvelope,
  type ObjectRef,
} from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import {
  PENDING_CAPTURE_MIME,
  makeObjectTransfer,
  readObjectTransfer,
  writeObjectTransfer,
} from "../features/object-transfer/objectTransfer";
import type { Paper } from "../features/workspace/workspace.types";
import type { PdfAnnotationV2 } from "../features/pdf/pdfAnnotationStorage";
import type { AgentArtifactResult } from "../features/artifacts/artifact.types";
import { artifactAnnotationNotes } from "../features/notes/artifactNotesSource";
import {
  createNoteFileService,
  subscribeNoteFiles,
  type NoteFileSnapshot,
  type ImportedNoteFile,
} from "../features/note-files/noteFileService";
import type { ObjectWorkbenchPort } from "../features/objects/objectWorkbenchPort";
import {
  createNotesRepository,
  notesTargetSchema,
} from "../features/notes/notesRepository";
import { readNotesFileDrop } from "../features/notes/notesFileDrop";
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
  receiveContextDrop?: ObjectWorkbenchPort["receiveContextDrop"];
  openExternalFile?(file: NoteFileSnapshot): void | Promise<void>;
  dragExternalFile?(file: NoteFileSnapshot, data: DataTransfer): void;
  exportBoardFile?(ref: ObjectRef): Promise<string>;
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
  const files = useMemo(
    () => createNoteFileService(input.scopeId, () => latest.current.scopeId),
    [input.scopeId],
  );
  const externalCache = useRef<{ folders: NotesFolder[]; items: NotesItem[] }>({
    folders: [],
    items: [],
  });
  const externalFolderId = (mountId: string, path = "") =>
    `external:${mountId}:${path}`;
  const [folders, setFolders] = useState<NotesFolder[]>(DEFAULT_NOTES_FOLDERS);
  const [sources, setSources] = useState<NotesItem[]>([]);
  const [references, setReferences] = useState<NotesReference[]>([]);
  const [folderId, setFolderId] = useState(NOTES_ROOT);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceWarning, setSourceWarning] = useState("");
  const [externalWarning, setExternalWarning] = useState("");
  const fileRefreshState = useRef<{ running?: Promise<void>; again: boolean }>({
    again: false,
  });
  const sourceCache = useRef<{ pdf: NotesItem[]; artifacts: NotesItem[] }>({
    pdf: [],
    artifacts: [],
  });
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
      paperAnchors: object.paperAnchors,
      title: formatPaperAnchorText(object.title || "笔记", object.paperAnchors),
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
      automaticallyListed: editable || object.kind === "workspace.board",
    };
  };
  async function fromFile(file: NoteFileSnapshot): Promise<NotesItem> {
    const target: NotesTarget = {
      kind: "external-file",
      mountId: file.mountId,
      path: file.path,
    };
    const markdown = /\.(md|markdown)$/i.test(file.path);
    const object = markdown
      ? await repository.projectLegacy(
          `note-file-${file.mountId}-${file.path}`,
          {
            kind: "content.note",
            title: file.name,
            content: {
              schema: "liteasy.note/v1",
              payload: { text: file.text, origin: "external" },
            },
          },
        )
      : undefined;
    if (object)
      await repository.setObjectFileBinding(object.objectId, {
        mountId: file.mountId,
        path: file.path,
        version: file.version,
        objectRevision: object.revision,
      });
    return {
      key: notesTargetKey(target),
      target,
      object,
      file,
      title: file.name,
      text: markdown ? file.text : "",
      source: file.path,
      defaultFolderId: externalFolderId(
        file.mountId,
        file.path.split("/").slice(0, -1).join("/"),
      ),
      updatedAt: object?.updatedAt ?? "",
      editable: markdown,
      automaticallyListed: true,
    };
  }
  function refreshFiles() {
    const state = fileRefreshState.current;
    if (state.running) {
      state.again = true;
      return state.running;
    }
    // Projecting files notifies the shared object store. Coalesce those events
    // into one subsequent scan instead of queueing a full Vault walk per file.
    state.running = (async () => {
      do {
        state.again = false;
        await readExternalFiles();
      } while (state.again && active());
    })().finally(() => {
      state.running = undefined;
    });
    return state.running;
  }
  async function readExternalFiles() {
    const mounts = await files.listMounts();
    const nextFolders: NotesFolder[] = [];
    const nextItems: NotesItem[] = [];
    let unavailable = false;
    for (const mount of mounts) {
      if (mount.kind === "directory")
        nextFolders.push({
          folderId: externalFolderId(mount.id),
          parentId: NOTES_ROOT,
          name: mount.name,
          system: true,
          external: { mountId: mount.id, path: "" },
        });
      try {
        const entries = await files.listEntries(mount.id);
        for (const entry of entries) {
          if (entry.kind === "directory") {
            nextFolders.push({
              folderId: externalFolderId(mount.id, entry.path),
              parentId: externalFolderId(
                mount.id,
                entry.path.split("/").slice(0, -1).join("/"),
              ),
              name: entry.name,
              system: true,
              external: { mountId: mount.id, path: entry.path },
            });
          } else if (/\.(md|markdown|canvas)$/i.test(entry.name)) {
            try {
              const item = await fromFile(
                await files.readFile(mount.id, entry.path),
              );
              if (mount.kind === "file") item.defaultFolderId = NOTES_ROOT;
              nextItems.push(item);
            } catch {
              unavailable = true;
              nextItems.push(
                ...externalCache.current.items.filter(
                  (item) =>
                    item.file?.mountId === mount.id &&
                    item.file.path === entry.path,
                ),
              );
            }
          }
        }
      } catch {
        unavailable = true;
        nextFolders.push(
          ...externalCache.current.folders.filter(
            (folder) =>
              folder.external?.mountId === mount.id && folder.external.path,
          ),
        );
        nextItems.push(
          ...externalCache.current.items.filter(
            (item) => item.file?.mountId === mount.id,
          ),
        );
      }
    }
    if (!active()) return;
    externalCache.current = { folders: nextFolders, items: nextItems };
    setExternalWarning(
      unavailable ? "外部文件夹暂时不可用；本机笔记仍已保存。" : "",
    );
  }
  const filename = (title: string, extension = "md") => {
    const stem =
      title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/, "")
        .slice(0, 100) || "笔记";
    return new RegExp(`\\.${extension}$`, "i").test(stem)
      ? stem
      : `${stem}.${extension}`;
  };
  async function writeExternal(
    item: Pick<NotesItem, "title" | "text"> & Partial<NotesItem>,
    destination: { mountId: string; path: string },
  ) {
    const board = item.object?.kind === "workspace.board";
    let text = item.file?.text ?? `# ${item.title}\n\n${item.text}`;
    if (board) {
      if (!latest.current.exportBoardFile) throw new Error("无法导出此白板。");
      text = await latest.current.exportBoardFile!(refOf(item.object!));
    } else if (!item.file) {
      const quote =
        item.annotation?.excerpt ??
        (item.object?.kind === "content.fragment"
          ? item.object.content.payload.anchors
              .map((anchor) => ("quote" in anchor ? anchor.quote.exact : ""))
              .filter(Boolean)
              .join("\n")
          : "");
      if (quote && !item.text.includes(quote))
        text += `\n\n<details>\n<summary>原文</summary>\n\n${quote
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n\n</details>`;
      if (item.object)
        text += `\n\n[打开来源](${objectLink(refOf(item.object))})`;
      text += "\n";
    }
    const extension =
      board || /\.canvas$/i.test(item.file?.path ?? "")
        ? "canvas"
        : /\.markdown$/i.test(item.title)
          ? "markdown"
          : "md";
    const name = filename(item.title, extension);
    const entries = await files.listEntries(destination.mountId);
    const prefix = destination.path ? `${destination.path}/` : "";
    let path = `${prefix}${name}`;
    for (let suffix = 2; entries.some((entry) => entry.path === path); suffix++)
      path = `${prefix}${name.slice(0, -(extension.length + 1))} (${suffix}).${extension}`;
    // A create-only write protects existing Vault files, even if another
    // application creates the same filename after the directory was listed.
    await files.writeFile({
      mountId: destination.mountId,
      path,
      text,
      expectedVersion: null,
    });
  }
  async function importFiles(
    incoming?: File[],
    destination = folderId,
    dropped?: Promise<ImportedNoteFile[]>,
  ) {
    await perform(async () => {
      const picked = dropped
        ? await dropped
        : incoming
          ? await Promise.all(
              incoming.map(async (file) => ({
                name: file.name,
                path: file.webkitRelativePath || file.name,
                text: await file.text(),
              })),
            )
          : await files.pickFiles();
      if (picked.some((file) => !/\.(md|markdown)$/i.test(file.name)))
        throw new Error(
          "请选择 Markdown 文件（.md 或 .markdown）。白板文件请在白板中打开。",
        );
      const external = folders.find(
        (folder) => folder.folderId === destination,
      )?.external;
      const knownFolders = await notes.listFolders();
      for (const file of picked) {
        if (file.text.length > 8 * 1024 * 1024)
          throw new Error(`文件过大：${file.name}`);
        if (external) {
          let target = external;
          if (incoming || dropped) {
            const parents = file.path
              .replace(/\\/g, "/")
              .split("/")
              .slice(0, -1);
            if (parents.some((part) => !part || part === "." || part === ".."))
              throw new Error("导入文件路径无效。");
            if (parents.length) {
              const path = [external.path, ...parents]
                .filter(Boolean)
                .join("/");
              await files.createDirectory(external.mountId, path);
              target = { ...external, path };
            }
          }
          await writeExternal(
            {
              title: file.name,
              text: file.text,
              file: {
                mountId: external.mountId,
                path: file.name,
                name: file.name,
                kind: "file",
                text: file.text,
                version: null,
              },
            },
            target,
          );
          continue;
        }
        let parent = destination;
        const segments = file.path.replace(/\\/g, "/").split("/");
        // Only browser directory drops supply a relative hierarchy; a native
        // picker may supply an absolute path, which is never an import target.
        if (
          (incoming || dropped) &&
          !file.path.startsWith("/") &&
          !segments.includes("..")
        ) {
          for (const name of segments.slice(0, -1).filter(Boolean)) {
            let folder = knownFolders.find(
              (candidate) =>
                candidate.parentId === parent && candidate.name === name,
            );
            if (!folder) {
              folder = await notes.createFolder(parent, name);
              knownFolders.push(folder);
            }
            parent = folder.folderId;
          }
        }
        const object = await repository.create({
          kind: "content.note",
          title: file.name,
          content: {
            schema: "liteasy.note/v1",
            payload: { text: file.text, origin: "user" },
          },
        });
        if (parent !== NOTES_ROOT && parent !== "default/note")
          await notes.collect(
            { kind: "object", ref: refOf(object), followLatest: true },
            parent,
          );
      }
      await refreshFiles();
    });
  }
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
            object.kind === "workspace.board" ||
            (object.kind === "content.note" &&
              object.createdBy.type === "user" &&
              object.content.payload.origin !== "external"),
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
          const folder =
            object.kind === "workspace.board" ||
            boardMembers.has(object.objectId)
              ? "default/board"
              : paperSource
                ? "default/paper"
                : "default/note";
          const item = fromObject(object, folder);
          if (boardMembers.has(object.objectId))
            item.source = `研究白板 · ${boardMembers.get(object.objectId)}`;
          return item;
        });
      const [nextFolders, nextReferences] = await Promise.all([
        notes.listFolders(),
        notes.listReferences(),
      ]);
      const publish = async () => {
        const indexed = new Map(
          [
            ...byDefault,
            ...sourceCache.current.pdf,
            ...sourceCache.current.artifacts,
            ...externalCache.current.items,
          ].map((item) => [item.key, item]),
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
            if (object.lifecycle !== "active")
              throw new Error("原内容已删除。");
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
        setFolders([...nextFolders, ...externalCache.current.folders]);
        setReferences(nextReferences);
        setSources([...indexed.values()]);
      };
      await publish();
      setError("");
      void refreshFiles()
        .then(async () => {
          if (active() && generation === request.current) await publish();
        })
        .catch(() => {
          if (active() && generation === request.current)
            setExternalWarning("外部文件夹暂时不可用；本机笔记仍已保存。");
        });
      // Optional remote/native sources must never hold up a local save or hide
      // durable notes. Publish the local store first, then enrich the view.
      void (async () => {
        const failedPapers = new Set<string>();
        const [pdfResult, artifactResult] = await Promise.allSettled([
          loadPdfNotes(latest.current.getPapers(), (id) =>
            failedPapers.add(id),
          ),
          latest.current.listArtifacts?.() ?? Promise.resolve([]),
        ]);
        if (!active() || generation !== request.current) return;
        if (pdfResult.status === "fulfilled")
          sourceCache.current.pdf = [
            ...pdfResult.value,
            ...sourceCache.current.pdf.filter(
              (item) => item.paper && failedPapers.has(item.paper.id),
            ),
          ];
        if (artifactResult.status === "fulfilled")
          sourceCache.current.artifacts = artifactAnnotationNotes(
            artifactResult.value,
          );
        setSourceWarning(
          failedPapers.size ||
            pdfResult.status === "rejected" ||
            artifactResult.status === "rejected"
            ? "部分来源暂时不可用；本机笔记仍已保存。"
            : "",
        );
        await publish();
      })().catch(() => {
        if (active() && generation === request.current)
          setSourceWarning("部分来源暂时不可用；本机笔记仍已保存。");
      });
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
    sourceCache.current = { pdf: [], artifacts: [] };
    externalCache.current = { folders: [], items: [] };
    setSourceWarning("");
    setExternalWarning("");
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
    const unsubscribeFiles = subscribeNoteFiles(input.scopeId, changed);
    window.addEventListener(NOTES_SOURCES_CHANGED, changed);
    window.addEventListener("focus", changed);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      unsubscribeFiles();
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
        normalized = {
          ...target,
          followLatest: userNote || object.kind === "workspace.board",
        };
        if (!destination) {
          if (object.kind === "workspace.board") folder = "default/board";
          else if (
            object.kind === "content.fragment" &&
            object.content.payload.anchors.some(
              (anchor) => anchor.type === "pdf",
            )
          )
            folder = "default/paper";
          else if (userNote) folder = "default/note";
        }
      } else if (target.kind === "pdf-annotation") {
        const match = (await loadPdfNotes(latest.current.getPapers())).find(
          (item) => item.key === notesTargetKey(target),
        );
        if (!match) throw new Error("原批注已不可用。");
        sourceCache.current.pdf = [
          ...sourceCache.current.pdf.filter((item) => item.key !== match.key),
          match,
        ];
        if (!destination) folder = "default/paper";
      } else if (target.kind === "external-file") {
        await files.readFile(target.mountId, target.path);
        if (!destination) folder = "default/note";
      } else {
        const match = artifactAnnotationNotes(
          (await latest.current.listArtifacts?.()) ?? [],
        ).find((item) => item.key === notesTargetKey(target));
        if (!match) throw new Error("原批注已不可用。");
        sourceCache.current.artifacts = [
          ...sourceCache.current.artifacts.filter(
            (item) => item.key !== match.key,
          ),
          match,
        ];
        if (!destination) folder = "default/artifact";
      }
      const external = folders.find(
        (item) => item.folderId === folder,
      )?.external;
      if (external) {
        const item =
          target.kind === "object"
            ? fromObject(await repository.get(target.ref))
            : target.kind === "external-file"
              ? await fromFile(
                  await files.readFile(target.mountId, target.path),
                )
              : [
                  ...sources,
                  ...(await loadPdfNotes(latest.current.getPapers())),
                ].find((candidate) => candidate.key === notesTargetKey(target));
        if (!item) throw new Error("来源暂时不可用，请稍后重试。");
        await writeExternal(item, external);
      } else await notes.collect(normalized, folder);
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
    sourceWarning: externalWarning || sourceWarning,
    selected: items.find((item) => item.key === selectedKey),
    selectFolder: (id) => {
      setFolderId(id);
      setSelectedKey("");
    },
    selectItem: (item) => setSelectedKey(item.key),
    search: setQuery,
    refresh,
    connectFolder: () =>
      perform(async () => {
        const mount = await files.chooseFolder();
        if (mount) {
          await refreshFiles();
          setFolderId(externalFolderId(mount.id));
        }
      }),
    importFiles,
    createFolder: (name) =>
      perform(async () => {
        const external = folders.find(
          (folder) => folder.folderId === folderId,
        )?.external;
        if (external) {
          if (
            !name.trim() ||
            /[\\/]/.test(name) ||
            [".", ".."].includes(name.trim())
          )
            throw new Error("请输入有效的目录名。");
          const path = external.path
            ? `${external.path}/${name.trim()}`
            : name.trim();
          await files.createDirectory(external.mountId, path);
          await refreshFiles();
          setFolderId(externalFolderId(external.mountId, path));
        } else {
          const folder = await notes.createFolder(folderId, name);
          setFolderId(folder.folderId);
        }
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
        const external = folders.find(
          (folder) => folder.folderId === folderId,
        )?.external;
        if (external) {
          await writeExternal(
            { title: text.trim().split("\n")[0], text },
            external,
          );
          await refreshFiles();
          return;
        }
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
        if (!item.editable) throw new Error("请在来源页面编辑此内容。");
        if (item.file) {
          await files.writeFile({
            mountId: item.file.mountId,
            path: item.file.path,
            text,
            expectedVersion: item.file.version,
          });
          await refreshFiles();
          return;
        }
        if (!item.object) throw new Error("请在来源页面编辑此内容。");
        await repository.editNote(
          refOf(item.object),
          text,
          /\.(md|markdown)$/i.test(item.object.title)
            ? item.object.title
            : text.trim().split("\n")[0].slice(0, 100) || "笔记",
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
      if (item.file && /\.canvas$/i.test(item.file.path)) {
        void perform(async () => {
          if (!latest.current.openExternalFile)
            throw new Error("无法打开此白板文件。");
          await latest.current.openExternalFile(item.file!);
        }).catch(() => undefined);
      } else if (item.file) setSelectedKey(item.key);
      else if (item.paper && item.annotation)
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
      if (item.file && /\.canvas$/i.test(item.file.path))
        latest.current.dragExternalFile?.(item.file, data);
      else if (item.paper && item.annotation)
        latest.current.dragAnnotation?.(item.paper, item.annotation, data);
      else if (item.object)
        writeObjectTransfer(
          data,
          makeObjectTransfer([refOf(item.object)], item.text),
        );
      data.effectAllowed = "copy";
    },
    drop: (data, destination) =>
      perform(async () => {
        const droppedFiles = readNotesFileDrop(data);
        if (droppedFiles) {
          await importFiles(undefined, destination, droppedFiles);
          return;
        }
        const note = data.getData(NOTES_REFERENCE_MIME);
        if (note) {
          await collect(notesTargetSchema.parse(JSON.parse(note)), destination);
          return;
        }
        // Consume a trusted ticket while the drag payload is still readable. It
        // materializes the annotation without opening or placing it on a board.
        if (data.getData(PENDING_CAPTURE_MIME)) {
          if (!latest.current.receiveContextDrop)
            throw new Error("无法接收此内容，请重新拖动。");
          const captured = await latest.current.receiveContextDrop(data);
          if (!captured?.length)
            throw new Error("拖动内容已失效，请重新拖动。");
          for (const ref of captured.flatMap((item) => item.refs))
            await collect({ kind: "object", ref }, destination);
          return;
        }
        const transfer = readObjectTransfer(data);
        if (transfer)
          for (const ref of transfer.refs)
            await collect({ kind: "object", ref }, destination);
      }),
  };
  return { model, port, refresh };
}
