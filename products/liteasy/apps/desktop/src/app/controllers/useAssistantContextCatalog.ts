import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantComposerSuggestion, AssistantContextToken } from "../features/assistant/assistant.types";
import type { ArtifactTab } from "../features/artifacts/artifact.types";
import { createNoteFileService, subscribeNoteFiles } from "../features/note-files/noteFileService";
import { ARTIFACT_CONTEXT_MIME } from "../features/object-transfer/contextTransfer";
import { makeObjectTransfer, OBJECT_TRANSFER_MIME } from "../features/object-transfer/objectTransfer";
import { refOf, type ObjectEnvelope, type ObjectRef } from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { ObjectWorkbenchPort } from "../features/objects/objectWorkbenchPort";

import { createNoteFileCatalogIndex, type CatalogFile } from "../features/note-files/noteFileCatalogIndex";
import type { PaperProjectsController } from "./usePaperProjectsController";
import { describeObjectSetting, explainableSettingKeys, settingsRegistry } from "../features/settings/settingsRegistry";
import type { SettingsState } from "../features/settings/settings.types";
import { contextPreviewText, readObjectContextPreview } from "../features/assistant/contextAssetPreview";
import { artifactContextText } from "../features/artifacts/artifactContext";
import { parseCanvasFile } from "../features/boards/boardFileFormat";
import { preparePdfAnnotationCapture } from "../features/pdf/pdfAnnotationCapture";
import { createObjectStorage, subscribeObjectStorage } from "../features/objects/objectStorage";
import { createReadingLibraryRepository } from "../features/reading-library/readingLibraryRepository";
import { builtinHelpProviders } from "../features/help/builtinHelpProvider";
import type { HelpArticleEntry } from "../features/help/help.types";
import { createHelpCatalog } from "../features/help/helpCatalog";
import type { Paper } from "../features/workspace/workspace.types";
import { loadPdfNotes } from "../features/notes/pdfNotesSource";
import { NOTES_SOURCES_CHANGED } from "../features/notes/notesPort";
import type { NotesItem } from "../features/notes/notes.types";
import { liteasyPath } from "../features/resource-filesystem/liteasyPath";

/** Catalog stores may publish a new array for progress without changing any entries. */
function useStableCatalogItems<T>(items: T[]) {
  const previous = useRef(items);
  if (previous.current !== items && (previous.current.length !== items.length ||
    items.some((item, index) => item !== previous.current[index]))) {
    previous.current = items;
  }
  return previous.current;
}

export function useAssistantContextCatalog(input: {
  artifacts: ArtifactTab[];
  objects: ObjectEnvelope[];
  port: ObjectWorkbenchPort;
  repository: ObjectRepository;
  projects?: PaperProjectsController;
  papers?: Paper[];
  settings?: SettingsState;
}) {
  const latest = useRef(input);
  latest.current = input;
  const scopeId = input.repository.scopeId;
  const artifacts = useStableCatalogItems(input.artifacts);
  const objects = useStableCatalogItems(input.objects);
  const papers = useStableCatalogItems(input.papers ?? []);
  const files = useMemo(() => createNoteFileService(scopeId, () => latest.current.repository.scopeId), [scopeId]);
  const [fileState, setFileState] = useState({ scopeId, items: [] as CatalogFile[] });
  const [titleState, setTitleState] = useState({ scopeId, items: [] as Array<{ objectId: string; title: string; kind?: ObjectEnvelope["kind"] }> });
  const [helpArticles, setHelpArticles] = useState<HelpArticleEntry[]>([]);
  const [annotationState, setAnnotationState] = useState({ scopeId, items: [] as NotesItem[] });
  const catalog = fileState.scopeId === scopeId ? fileState.items : [];
  const titles = titleState.scopeId === scopeId ? titleState.items : [];
  const annotations = annotationState.scopeId === scopeId ? annotationState.items : [];
  useEffect(() => {
    let disposed = false;
    let readVersion = 0;
    let timer: ReturnType<typeof setTimeout>;
    setAnnotationState({ scopeId, items: [] });
    const refresh = async () => {
      const version = ++readVersion;
      const notes = await loadPdfNotes(papers);
      if (!disposed && version === readVersion) setAnnotationState({ scopeId, items: notes });
    };
    void refresh();
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 150); };
    window.addEventListener(NOTES_SOURCES_CHANGED, changed);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener(NOTES_SOURCES_CHANGED, changed); };
  }, [papers, scopeId]);
  useEffect(() => {
    let disposed = false;
    let readVersion = 0;
    let timer: ReturnType<typeof setTimeout>;
    setTitleState({ scopeId, items: [] });
    const reading = createReadingLibraryRepository(createObjectStorage(scopeId, () => latest.current.repository.scopeId), scopeId);
    const refresh = async () => {
      const version = ++readVersion;
      const [index, readingFiles] = await Promise.all([input.repository.searchTitles("", Number.MAX_SAFE_INTEGER), reading.list()]);
      const readingIds = new Set(readingFiles.map((file) => file.ref.objectId));
      const next = index.map((item) => readingIds.has(item.objectId) ? { ...item, kind: "source.document" as const } : item);
      if (!disposed && version === readVersion) setTitleState((old) => old.scopeId === scopeId && JSON.stringify(old.items) === JSON.stringify(next) ? old : { scopeId, items: next });
    };
    void refresh().catch(() => undefined);
    const unsubscribe = subscribeObjectStorage(scopeId, () => {
      clearTimeout(timer); timer = setTimeout(() => void refresh().catch(() => undefined), 120);
    });
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
  }, [input.repository, scopeId]);
  useEffect(() => {
    const abort = new AbortController();
    void createHelpCatalog(builtinHelpProviders).search({ query: "", locale: "zh-CN", signal: abort.signal })
      .then((entries) => { if (!abort.signal.aborted) setHelpArticles(entries); }).catch(() => undefined);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setFileState({ scopeId, items: [] });
    const index = createNoteFileCatalogIndex({ files, onChange: (items) => setFileState({ scopeId, items }) });
    void index.refresh();
    const unsubscribe = subscribeNoteFiles(scopeId, index.change);
    const focus = () => index.requestRefresh();
    window.addEventListener("focus", focus);
    return () => { index.dispose(); unsubscribe(); window.removeEventListener("focus", focus); };
  }, [files, scopeId]);

  return useMemo(() => {
    const projects = (input.projects?.catalog ?? []).filter(({ project }) => project.scopeId === scopeId);
    function assertCurrentScope() {
      if (latest.current.repository.scopeId !== scopeId) throw new Error("账号已切换，请重新选择上下文。");
    }

    async function resolveTransfer(mime: string, value: string): Promise<AssistantContextToken> {
      assertCurrentScope();
      const attachments = await latest.current.port.receiveContextDrop?.({ getData: (key) => key === mime ? value : "" });
      if (!attachments?.length) throw new Error("这份内容暂时无法添加，请刷新后重试。");
      const attachment = attachments[0];
      assertCurrentScope();
      return { id: `object-${JSON.stringify(attachment.ref)}`, kind: "object", label: attachment.title,
        detail: attachment.detail, prompt: "", contextRefs: attachments.flatMap((item) => item.refs) };
    }

    async function resolveObject(ref: ObjectRef) {
      return resolveTransfer(OBJECT_TRANSFER_MIME, JSON.stringify(makeObjectTransfer([ref])));
    }
    async function resolvePath(path: string): Promise<AssistantContextToken> {
      assertCurrentScope();
      const attachments = await latest.current.port.resolveLiteasyPath?.(path);
      assertCurrentScope();
      if (!attachments?.length) throw new Error("这条批注暂不可用，请刷新后重试。");
      return { id: path, kind: "object", label: attachments[0].title, prompt: "", contextRefs: attachments.flatMap((item) => item.refs) };
    }

    const suggestions: AssistantComposerSuggestion[] = [
      ...artifacts.map((artifact) => ({
        id: `artifact-${artifact.artifactId}`, trigger: "@" as const, label: artifact.title,
        category: "产物", description: "使用生成内容作为参考，保留来源关系。", preview: contextPreviewText(artifactContextText(artifact)),
        detail: artifact.sourcePath ?? artifact.resultPath ?? `产物/${artifact.type === "thin_reading" ? "薄读" : "生成文档"}/${artifact.title}`,
        resolveToken: () => resolveTransfer(ARTIFACT_CONTEXT_MIME, artifact.artifactId),
      })),
      ...catalog.map((file) => ({
        id: `file-${file.mountId}-${file.path}`, trigger: "@" as const, label: file.name, detail: file.location,
        category: /\.canvas$/i.test(file.name) ? "白板" : "笔记", description: "从连接的文件夹读取，加入时固定当前版本。",
        loadPreview: async () => {
          assertCurrentScope();
          const snapshot = await files.readFile(file.mountId, file.path);
          assertCurrentScope();
          if (!/\.canvas$/i.test(file.name)) return { text: contextPreviewText(snapshot.text) };
          const board = parseCanvasFile(snapshot.text);
          const contents = await Promise.all(board.nodes.slice(0, 20).map(async (node) => {
            const text = node.type === "file" ? (await files.readFile(file.mountId, node.file!)).text : node.text ?? node.url ?? "";
            assertCurrentScope();
            return contextPreviewText(text, 500);
          }));
          return { text: contextPreviewText([`包含 ${board.nodes.length} 个元素、${board.edges.length} 条连接；添加时会包含元素内容和白板布局。`,
            ...contents, ...(board.nodes.length > 20 ? ["…（仅预览前 20 个元素）"] : [])].join("\n\n")) };
        },
        resolveToken: async () => {
          const snapshot = await files.readFile(file.mountId, file.path);
          assertCurrentScope();
          let ref: ObjectRef;
          if (/\.canvas$/i.test(file.name)) {
            const board = await latest.current.port.resolveBoardFile?.(snapshot);
            if (!board) throw new Error("当前白板文件无法加入上下文。");
            ref = board;
          } else {
            if (!snapshot.text.trim()) throw new Error("这份文件还没有可添加的正文。");
            ref = refOf(await input.repository.projectLegacy(`note-file-${file.mountId}-${file.path}`, {
              kind: "content.note", title: file.name,
              content: { schema: "liteasy.note/v1", payload: { text: snapshot.text, origin: "external" } },
            }));
            await input.repository.setObjectFileBinding(ref.objectId, { mountId: file.mountId, path: file.path, version: snapshot.version, objectRevision: ref.revision });
          }
          return { ...await resolveObject(ref), detail: file.location };
        },
      })),
      ...objects.filter((object) => object.scopeId === scopeId && !projects.some(({ assets }) => assets.some((asset) => asset.ref?.objectId === object.objectId))).map((object) => ({
        id: `saved-${object.objectId}`, trigger: "@" as const, label: object.title,
        category: object.kind === "source.document" ? "阅读文件" : object.kind === "workspace.board" ? "白板" : object.kind === "content.fragment" ? "摘录" : object.kind === "artifact.document" ? "产物" : object.kind === "conversation.message" ? "对话" : "笔记",
        readOnly: object.kind === "source.document",
        loadPreview: async () => {
          assertCurrentScope();
          return readObjectContextPreview(input.repository, await input.repository.resolveLatest(object.objectId), assertCurrentScope);
        },
        description: object.kind === "source.document" ? "原始来源只读；长文按本轮问题选段并标明覆盖范围。" : "加入时固定版本，可与其他论文或项目一起使用。",
        detail: `${object.kind === "workspace.board" ? "研究白板" : "笔记"}/${object.title}`,
        resolveToken: async () => resolveObject(refOf(await input.repository.resolveLatest(object.objectId))),
      })),
      ...titles.filter((entry) => !objects.some((object) => object.scopeId === scopeId && object.objectId === entry.objectId) &&
        !projects.some(({ assets }) => assets.some((asset) => asset.ref?.objectId === entry.objectId))).map((entry) => ({
        id: `saved-${entry.objectId}`, trigger: "@" as const, label: entry.title,
        category: entry.kind === "source.document" ? "阅读文件" : entry.kind === "workspace.board" ? "白板" : entry.kind === "content.fragment" ? "摘录" : entry.kind === "artifact.document" ? "产物" : entry.kind === "conversation.message" ? "对话" : entry.kind === "content.note" ? "笔记" : "已保存内容",
        readOnly: entry.kind === "source.document", description: "加入时读取正文并固定当前版本，可跨项目组合。",
        resolveToken: async () => { assertCurrentScope(); return resolveObject(refOf(await input.repository.resolveLatest(entry.objectId))); },
        loadPreview: async () => { assertCurrentScope(); return readObjectContextPreview(input.repository, await input.repository.resolveLatest(entry.objectId), assertCurrentScope); },
      })),
      ...projects.flatMap(({ project, assets }): AssistantComposerSuggestion[] => {
        const common = { projectId: project.projectId, projectTitle: project.title, trigger: "@" as const };
        const resolveAsset = async (asset: typeof assets[number]) => {
          assertCurrentScope();
          if (asset.ref) return resolveObject(asset.role === "derived"
            ? refOf(await input.repository.resolveLatest(asset.ref.objectId)) : asset.ref);
          if (asset.artifactId) return resolveTransfer(ARTIFACT_CONTEXT_MIME, asset.artifactId);
          throw new Error("资源当前不可读取，请刷新项目。");
        };
        return [{ ...common, id: `project-${project.projectId}`, label: project.title, category: "项目",
          detail: `${assets.length} 项资产 · 可与其他项目组合`,
          description: "包含已识别的原文、图片和后续成果。也可展开项目，只添加需要的资产。",
          preview: contextPreviewText(assets.map((asset) => `• ${asset.title}${asset.page ? ` · 第 ${asset.page} 页` : ""}`).join("\n")) || "这个项目还没有资产。",
          unavailableReason: assets.length ? undefined : "尚无可读资产，论文解析完成后自动加入。可先创建笔记。",
          createNote: async (text) => {
            assertCurrentScope();
            const asset = await latest.current.projects!.createNote(project.projectId, text);
            return resolveAsset(asset);
          },
          resolveToken: async () => {
            assertCurrentScope();
            const fixed = await latest.current.projects!.repository.listAssets(project.projectId);
            const refs = [];
            for (const asset of fixed) refs.push(...((await resolveAsset(asset)).contextRefs ?? []));
            if (!refs.length) throw new Error("这个项目还没有可添加的内容。");
            assertCurrentScope();
            return { id: `project-${project.projectId}`, kind: "object", label: project.title,
              detail: `${fixed.length} 项资产 · 已固定本次成员与版本`, prompt: "", contextRefs: refs };
          },
        }, ...assets.map((asset) => ({ ...common, id: `project-asset-${project.projectId}-${asset.assetId}`,
          label: asset.title, category: ({ text: "原文", image: "图片", note: "笔记", board: "白板", artifact: "产物", excerpt: "摘录" })[asset.kind],
          readOnly: asset.role === "source" || asset.kind === "text" || asset.kind === "image", detail: `${project.title}${asset.page ? ` · 第 ${asset.page} 页` : ""}`,
          description: asset.role === "source" || asset.kind === "text" || asset.kind === "image" ? "论文来源只读。修改请创建副本，原文与原图始终保留。" : "可跨论文、跨项目组合引用。",
          preview: asset.artifactId ? contextPreviewText(artifactContextText(artifacts.find((artifact) => artifact.artifactId === asset.artifactId) ?? { title: asset.title })) : asset.description,
          loadPreview: asset.ref ? async () => {
            assertCurrentScope();
            const object = asset.role === "derived" ? await input.repository.resolveLatest(asset.ref!.objectId) : await input.repository.get(asset.ref!);
            return readObjectContextPreview(input.repository, object, assertCurrentScope);
          } : undefined,
          resolveToken: () => resolveAsset(asset),
          ...((asset.role === "source" || asset.kind === "text" || asset.kind === "image") && asset.ref ? { createEditableCopy: async () => {
            assertCurrentScope();
            return resolveAsset(await latest.current.projects!.createEditableCopy(project.projectId, asset.ref!));
          } } : {}),
        }))];
      }),
      ...explainableSettingKeys.map((key) => ({ id: `setting-${key}`, trigger: "@" as const, category: "设置",
        label: settingsRegistry[key].label, detail: "当前值与设置说明", description: settingsRegistry[key].help, readOnly: true,
        preview: input.settings ? describeObjectSetting(key, input.settings)?.text : undefined,
        token: { id: `setting-${key}`, kind: "object" as const, label: settingsRegistry[key].label, prompt: "",
          contextRefs: [{ type: "setting" as const, key }] },
      })),
      ...helpArticles.map((article) => ({ id: `help-${article.ref.providerId}-${article.id}`, trigger: "@" as const,
        label: article.title, category: "帮助", description: article.summary, readOnly: true,
        loadPreview: async () => {
          assertCurrentScope();
          const document = await createHelpCatalog(builtinHelpProviders).read(article.ref, { locale: "zh-CN", signal: new AbortController().signal });
          assertCurrentScope();
          if (!document) throw new Error("帮助文章暂不可用。");
          return { text: contextPreviewText(document.body) };
        },
        resolveToken: async () => {
          assertCurrentScope();
          const document = await createHelpCatalog(builtinHelpProviders).read(article.ref, { locale: "zh-CN", signal: new AbortController().signal });
          if (!document) throw new Error("帮助文章暂不可用。");
          assertCurrentScope();
          const object = await input.repository.projectLegacy(`help:${article.ref.providerId}:${article.id}`, {
            kind: "source.document", title: document.title, content: { schema: "liteasy.source-document/v1", payload: {
              paperId: `help:${article.id}`, legacyKey: `help:${article.ref.providerId}:${article.id}`, availability: "local", text: document.body,
            } },
          });
          return resolveObject(refOf(object));
        },
      })),
      ...annotations.map((note) => {
        const project = projects.find((entry) => entry.project.paperId === note.paper?.id)?.project;
        return { id: `annotation-${note.key}`, trigger: "@" as const, label: note.title, category: "批注",
          projectId: project?.projectId, projectTitle: project?.title, detail: note.source,
          loadPreview: async () => {
            assertCurrentScope();
            if (!note.annotation || !note.paper) return { text: contextPreviewText(note.text) };
            const material = await preparePdfAnnotationCapture({ annotation: note.annotation, paper: note.paper });
            assertCurrentScope();
            return { text: contextPreviewText([material.text, material.quote && material.quote !== material.text ? `引用原文：${material.quote}` : ""].filter(Boolean).join("\n\n")),
              images: Object.values(material.images).map((url, index) => ({ url, label: `${note.title} · 图片 ${index + 1}` })) };
          },
          description: "同时添加评论与引用原文，保留页码和出处。",
          resolveToken: () => resolvePath(liteasyPath(scopeId, note.target)),
        };
      }),
      ...artifacts.flatMap((artifact) => (artifact.thinReadingDocument?.annotations ?? []).filter((note) => note.body.trim()).map((note) => ({
        id: `artifact-annotation-${artifact.artifactId}-${note.id}`, trigger: "@" as const, category: "批注", label: note.body.split("\n")[0].slice(0, 100),
        detail: artifact.title, preview: contextPreviewText(note.body), description: "生成产物中的个人批注。",
        resolveToken: () => resolvePath(liteasyPath(scopeId, { kind: "artifact-annotation", artifactId: artifact.artifactId, annotationId: note.id })),
      }))),
    ];
    return suggestions;
  }, [artifacts, objects, titles, helpArticles, annotations, input.repository, input.projects?.catalog, input.settings, catalog, files, scopeId]);
}
