import { relativeImagePath } from "./attachmentPath";
import type { AgentArtifactResult } from "../artifacts/artifact.types";
import { artifactContextText } from "../artifacts/artifactContext";
import { boardContextSnapshotSchema } from "../context/objectContext";
import type { NoteFileService, NoteFileSnapshot } from "../note-files/noteFileService";
import { MAX_NOTE_FILE_BYTES } from "../note-files/noteFileService";
import type { ResourceContextAttachment } from "../object-transfer/contextTransfer";
import type { ObjectRepository } from "../objects/objectRepository";
import { isPaperMetadataReference, objectText, refOf, type ObjectEnvelope } from "../objects/object.types";
import { stageImage } from "../objects/objectAssets";
import { MODEL_IMAGE_LIMITS, validateModelImages, type ModelImageInput } from "../models/modelImages";
import type { PaperProjectRepository, PaperProjectAsset } from "../paper-projects/paperProjectRepository";
import type { Paper } from "../workspace/workspace.types";
import { AgentAssetError, type AgentAsset, type AgentAssetAdapter, type AgentAssetReadOptions } from "./agentAsset.types";
import { assetChangedLines, createAgentAssetService, readAgentAssetText } from "./agentAssetService";
import { contextAttachments } from "./resourceContext";
import { liteasyPath, parseLiteasyPath } from "./liteasyPath";
import { resourceContentRevision, canonicalResourceJson } from "./resourceFileContent";
import { readAgentBoard, writeAgentBoard } from "./agentBoardAsset";
import { parseCanvasFile } from "../boards/boardFileFormat";
import { sourceDocumentBodyCapability } from "../reading-library/readingResourceCapabilities";

export type WorkspaceAgentAssetInput = {
  repository: ObjectRepository;
  files?: NoteFileService;
  projects?: PaperProjectRepository;
  active(): boolean;
  getPapers?(): Paper[];
  getPaperAbstract?(paper: Paper): Promise<string | undefined> | string | undefined;
  getArtifacts?(): Promise<AgentArtifactResult[]>;
  getArtifactTitles?(): Array<{ artifactId: string; title: string }>;
  /** Called only by an explicit asset read, never during discovery. */
  readPaper?(paper: Paper, options: AgentAssetReadOptions): Promise<string>;
  resolveContext?(path: string): Promise<ResourceContextAttachment[]>;
};

/** Built-in adapters share the real repositories used by the reader and editors. */
export function createWorkspaceAgentAssetService(input: WorkspaceAgentAssetInput) {
  const scope = input.repository.scopeId;
  const check = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!input.active()) throw new AgentAssetError("scope_changed", "账号已切换，请重新选择资产。");
  };
  async function relativeImages(basePath: string, relative: string, options?: { signal?: AbortSignal }) {
    check(options?.signal);
    const parsed = parseLiteasyPath(basePath, scope);
    const binding = parsed.kind === "external-file" ? parsed : parsed.kind === "object" ? (await input.repository.getObjectFileBinding(parsed.ref.objectId) ?? await input.repository.getAttachmentBase(parsed.ref.objectId)) : undefined;
    if (!binding || !input.files?.readImage) throw new AgentAssetError("unavailable", "此资源没有可解析的相对附件目录。");
    const path = relativeImagePath(binding.path, relative), image = await input.files.readImage(binding.mountId, path);
    check(options?.signal); return [{ base64: image.base64, mediaType: image.mediaType, label: path.split("/").at(-1) ?? "图片" }];
  }
  const accepts = (host: string) => (path: string) => new URL(path).hostname === host;
  const readCapabilities = (): AgentAsset["capabilities"] => ["search", "read", ...(input.resolveContext ? ["add_context" as const] : [])];
  const context = input.resolveContext ? (path: string) => input.resolveContext!(path) : undefined;
  const target = (path: string) => parseLiteasyPath(path, scope);
  const objectPath = (objectId: string) => liteasyPath(scope, { kind: "object", ref: { objectId, revision: "latest" }, followLatest: true });
  const findObject = async (path: string) => {
    const parsed = target(path);
    if (parsed.kind !== "object") throw new AgentAssetError("invalid_path", "请选择对象资产。");
    const object = parsed.followLatest ? await input.repository.resolveLatest(parsed.ref.objectId) : await input.repository.get(parsed.ref);
    if (object.lifecycle !== "active") throw new AgentAssetError("unavailable", "资产已归档或删除。");
    return object;
  };
  type Membership = { projectId: string; paperId: string; asset: PaperProjectAsset };
  const memberships = async (ids: Set<string>) => {
    const found: Membership[] = [];
    if (!input.projects || !ids.size) return found;
    for (const project of await input.projects.listProjects()) {
      check();
      for (const asset of await input.projects.listAssets(project.projectId)) {
        if (asset.ref && ids.has(asset.ref.objectId)) found.push({ projectId: project.projectId, paperId: project.paperId, asset });
      }
    }
    return found;
  };
  const describedObjectStat = async (object: Pick<ObjectEnvelope, "objectId" | "title" | "kind" | "revision"> & {
    paperId?: string; summary?: string; structuredType?: { id: string; version: string }; fileBinding?: { mountId: string; path: string };
  }, requestedPath?: string): Promise<AgentAsset> => {
    const related = await memberships(new Set([object.objectId]));
    const binding = object.fileBinding;
    const requested = requestedPath ? target(requestedPath) : undefined;
    const selector = requested?.kind === "object" ? requested.ref.selectorId : undefined;
    return { path: requestedPath ?? objectPath(object.objectId), title: object.title, kind: object.kind, revision: object.revision, ...(object.structuredType ? { structuredType: object.structuredType, summary: "结构化组件：通过 liteasy_block_read 读取字段，liteasy_block_update 按版本修改，保留布局。" } : {}),
      capabilities: ["search", "read", "add_context", ...(["content.note", "workspace.board"].includes(object.kind) && !binding && !selector ? ["write" as const] : [])],
      ...(object.kind === "source.document" ? { summary: object.summary || "摘要尚未提取；正文按需读取。" } : {}),
      ...(object.kind === "workspace.board" ? { summary: "JSON Canvas 白板：read 返回节点与连接；write 使用 replace 提交完整 JSON。保留节点 id 可保持未修改的原始引用；修改卡片会创建派生笔记，原始内容不变。" } : {}),
      ...(object.kind === "workspace.board" && selector ? { summary: "固定的白板布局与连接快照，仅供读取。" } : {}),
      ...(binding ? { summary: `此资产映射到文件，请通过文件地址读取：${liteasyPath(scope, { kind: "external-file", mountId: binding.mountId, path: binding.path })}` } : {}),
      relatedPaperIds: [...new Set([...related.map((item) => item.paperId), ...(object.paperId ? [object.paperId] : [])])],
    };
  };
  const objectStat = async (object: ObjectEnvelope, path?: string) => describedObjectStat({
    ...object, ...(object.kind === "source.document" ? { paperId: object.content.payload.paperId,
      summary: [isPaperMetadataReference(object) ? "题录已固定；正文按需读取。" : "", object.content.payload.abstractText?.slice(0, 4000)].filter(Boolean).join("\n") } : {}),
    fileBinding: (await input.repository.describeObject(object.objectId)).fileBinding,
  }, path);
  const imageExtension = /\.(png|jpe?g|gif|webp)$/i;
  async function resolveObjectImages(path: string, options?: { signal?: AbortSignal }, resolvingImages = new Set<string>()): Promise<ModelImageInput[]> {
      const parsed = target(path);
      if (parsed.kind === "object" && parsed.ref.selectorId) return [];
      const object = await findObject(path);
      const descriptors = object.assets.filter((asset) => asset.mediaType.startsWith("image/"));
      if (descriptors.length > MODEL_IMAGE_LIMITS.count || descriptors.some((asset) => asset.byteLength > MODEL_IMAGE_LIMITS.imageBytes) ||
        descriptors.reduce((total, asset) => total + asset.byteLength, 0) > MODEL_IMAGE_LIMITS.totalBytes) {
        throw new AgentAssetError("invalid_request", "图片超出本轮上限，请分批添加或缩小图片。");
      }
      const result: ModelImageInput[] = [];
      for (const descriptor of descriptors) {
        check(options?.signal);
        const stored = await input.repository.readAsset(descriptor.assetId);
        const image = { base64: stored.base64, mediaType: descriptor.mediaType, label: `资料图片：${object.title}`.slice(0, 1000) };
        validateModelImages([...result, image]);
        const verified = await stageImage(Uint8Array.from(atob(stored.base64), (character) => character.charCodeAt(0)), descriptor.mediaType);
        if (verified.sha256 !== descriptor.sha256 || verified.byteLength !== descriptor.byteLength || stored.mediaType !== descriptor.mediaType) {
          throw new AgentAssetError("revision_conflict", "图片与固定的资产版本不一致，请重新添加。");
        }
        result.push(image);
      }
      const block = await input.repository.getStructuredBlock(refOf(object));
      const source = block?.data.image;
      if (typeof source === "string" && source && !resolvingImages.has(path) && resolvingImages.size < 8) {
        resolvingImages.add(path);
        try {
          if (source.startsWith("liteasy://")) {
            const imageTarget = target(source);
            if (imageTarget.kind === "object" && source !== path) result.push(...await resolveObjectImages(source, options, resolvingImages));
            else if (imageTarget.kind === "external-file" && input.files?.readImage) {
              const image = await input.files.readImage(imageTarget.mountId, imageTarget.path);
              result.push({ base64: image.base64, mediaType: image.mediaType, label: object.title });
            }
          } else if (!/^[a-z][a-z0-9+.-]*:/i.test(source)) result.push(...await relativeImages(path, source, options));
        } finally { resolvingImages.delete(path); }
      }
      check(options?.signal);
      validateModelImages(result);
      return result;
    }
  const objects: AgentAssetAdapter = {
    id: "workspace-objects", accepts: accepts("objects"),
    async search({ query, limit = 30, signal }) {
      check(signal);
      let term = query;
      if (query.startsWith("liteasy://objects/")) {
        try {
          const parsed = target(query);
          if (parsed.kind === "object") term = parsed.ref.objectId;
        } catch { /* A partly typed path is still a search term. */ }
      }
      const rows = await input.repository.searchTitles(term, limit);
      const related = await memberships(new Set(rows.map((row) => row.objectId)));
      return rows.map((row) => ({ path: objectPath(row.objectId), title: row.title, kind: row.kind ?? "object", revision: row.revision,
        capabilities: ["search", "read", "add_context", ...(row.kind && ["content.note", "workspace.board"].includes(row.kind) ? ["write" as const] : [])],
        relatedPaperIds: [...new Set(related.filter((item) => item.asset.ref?.objectId === row.objectId).map((item) => item.paperId))],
      }));
    },
    async stat(path, options) {
      check(options?.signal);
      const parsed = target(path);
      if (parsed.kind !== "object") throw new AgentAssetError("invalid_path", "请选择对象资产。");
      const metadata = await input.repository.describeObject(parsed.ref.objectId);
      // Current metadata comes from the small title index; historical requests
      // still validate and describe the exact immutable revision.
      return !parsed.followLatest && parsed.ref.revision !== metadata.revision
        ? objectStat(await findObject(path), path) : describedObjectStat(metadata, path);
    },
    async read(path, options) {
      const object = await findObject(path);
      if (object.kind === "source.document" && object.content.payload.legacyKey.startsWith("reading-file:")) {
        const bodyCapability = sourceDocumentBodyCapability(object);
        if (!bodyCapability.available) throw new AgentAssetError("unavailable", bodyCapability.reason);
      }
      let text = objectText(object);
      const parsed = target(path);
      if (parsed.kind === "object" && parsed.ref.selectorId) {
        const selector = parsed.ref.selectorId;
        if (object.kind === "workspace.board" && selector.startsWith("board-context:")) {
          const fixed = boardContextSnapshotSchema.parse(await input.repository.getSnapshot(selector.slice("board-context:".length)));
          check(options.signal);
          if (fixed.scopeId !== scope || fixed.boardRef.objectId !== object.objectId || fixed.boardRef.revision !== object.revision) {
            throw new AgentAssetError("invalid_request", "白板结构与所选账号或版本不一致。");
          }
          text = fixed.text;
        } else if (object.kind === "source.document") {
          const selected = selector === "abstract" ? object.content.payload.abstractText
            : object.content.payload.pages?.find((page) => `page:${page.page}` === selector)?.text;
          if (selected === undefined) throw new AgentAssetError("unavailable", "选定的论文位置已不可用。");
          text = selected;
        } else if (object.kind === "artifact.document") {
          const block = object.content.payload.blocks.find((item) => item.blockId === selector);
          if (!block || block.type !== "markdown") throw new AgentAssetError("unavailable", "选定的产物片段已不可用。");
          text = block.text;
        } else if (object.kind !== "conversation.message" || object.content.payload.blockId !== selector) {
          throw new AgentAssetError("invalid_request", "选定的内容位置不可用，请重新加入具体选区。");
        }
      } else if (object.kind === "source.document" && isPaperMetadataReference(object)) {
        const paper = input.getPapers?.().find((item) => item.id === object.content.payload.paperId);
        if (!paper || !input.readPaper) throw new AgentAssetError("unavailable", "来源论文在当前工作区不可用。");
        const hash = object.content.payload.documentHash;
        if (hash && hash !== paper.contentHash) throw new AgentAssetError("revision_conflict", "论文文件版本已变化，请重新添加论文。");
        const body = await input.readPaper(paper, options);
        const after = input.getPapers?.().find((item) => item.id === paper.id);
        if (!after || hash && hash !== after.contentHash) throw new AgentAssetError("revision_conflict", "读取期间论文文件版本已变化，请重新添加论文。");
        text = `${hash ? "题录已固定；以下正文来自同一文件版本的已解析内容。" : "题录已固定；正文版本未固定，以下是读取时可用的内容。"}\n\n${body}`;
      }
      if (object.kind === "workspace.board" && !(parsed.kind === "object" && parsed.ref.selectorId)) {
        text = await readAgentBoard(input.repository, object);
      }
      check(options.signal);
      return readAgentAssetText(await objectStat(object, path), text, options);
    },
    resolveRelativeImages: relativeImages,
    resolveImages: resolveObjectImages,
    async write(path, options) {
      const parsed = target(path);
      if (parsed.kind === "object" && parsed.ref.selectorId) throw new AgentAssetError("read_only", "选区是只读引用，请通过笔记完整地址写入。");
      const object = await findObject(path);
      const latest = await input.repository.resolveLatest(object.objectId);
      if (latest.revision !== options.expectedRevision || object.revision !== options.expectedRevision) throw new AgentAssetError("revision_conflict", "笔记已被修改，请重新读取后再写入。");
      if (object.kind !== "content.note" && object.kind !== "workspace.board") throw new AgentAssetError("read_only", "请选择可编辑的笔记或白板。");
      const binding = object.kind === "content.note" ? await input.repository.getObjectFileBinding(object.objectId) : await input.repository.getBoardFileBinding(object.objectId);
      if (binding) throw new AgentAssetError("read_only", "此资产连接到外部文件，请使用其文件地址或在编辑器中保存。");
      if (object.kind === "workspace.board" && options.mode !== "replace") throw new AgentAssetError("invalid_request", "白板请使用 replace 提交完整的 JSON Canvas 文档。");
      const before = object.kind === "content.note" ? object.content.payload.text : await readAgentBoard(input.repository, object);
      const after = options.mode === "append" ? before + options.text : options.text;
      if (new TextEncoder().encode(after).byteLength > MAX_NOTE_FILE_BYTES) throw new AgentAssetError("invalid_request", "笔记写入后的正文不能超过 8 MiB。");
      const related = await memberships(new Set([object.objectId]));
      check(options.signal);
      const next = before === after ? object : object.kind === "workspace.board"
        ? await writeAgentBoard(input.repository, object, after, () => input.active() && !options.signal?.aborted)
        : await input.repository.editNote(refOf(object), after);
      const warnings: string[] = [];
      // The body commit is authoritative; a delayed index refresh must not report it as failed.
      if (input.active() && next !== object) {
        for (const member of related) {
          try { await input.projects!.addAsset(member.projectId, { ...member.asset, ref: refOf(next), title: next.title }); }
          catch { warnings.push("笔记正文已保存；项目索引暂未刷新，请重新打开文献库。"); break; }
        }
      }
      if (!input.active()) warnings.push("笔记已保存到原账号；当前账号已切换。");
      return { asset: { path: objectPath(next.objectId), title: next.title, kind: next.kind, revision: next.revision,
        capabilities: ["search", "read", "write", "add_context"], relatedPaperIds: [...new Set(related.map((item) => item.paperId))] },
        previousRevision: object.revision, changed: next.revision !== object.revision,
        ...assetChangedLines(before, after), ...(warnings.length ? { warnings } : {}) };
    },
    async context(path) {
      if (context) return context(path);
      const parsed = target(path);
      const ref = refOf(await findObject(path));
      return contextAttachments(input.repository, [{ ...ref, ...(parsed.kind === "object" && parsed.ref.selectorId ? { selectorId: parsed.ref.selectorId } : {}) }], input.active);
    },
  };
  const adapters: AgentAssetAdapter[] = [objects];
  if (input.files) {
    const files = input.files;
    const fileSnapshot = async (path: string) => {
      const parsed = target(path);
      if (parsed.kind !== "external-file") throw new AgentAssetError("invalid_path", "请选择文件资产。");
      return files.readFile(parsed.mountId, parsed.path);
    };
    const fileStat = (file: NoteFileSnapshot): AgentAsset => ({
      path: liteasyPath(scope, { kind: "external-file", mountId: file.mountId, path: file.path }),
      title: file.name, kind: imageExtension.test(file.path) ? "image" : /\.canvas$/i.test(file.path) ? "canvas" : "markdown", ...(file.version ? { revision: file.version } : {}),
      capabilities: [...readCapabilities(), ...(!imageExtension.test(file.path) ? ["write" as const] : [])],
      ...(/\.canvas$/i.test(file.path) ? { summary: "JSON Canvas 文件；使用 replace 提交完整且有效的 JSON Canvas。" } : {}),
    });
    const describeFile = async (path: string) => {
      const parsed = target(path);
      if (parsed.kind !== "external-file") throw new AgentAssetError("invalid_path", "请选择文件资产。");
      if (!imageExtension.test(parsed.path)) return fileSnapshot(path);
      const file = (await files.listEntries(parsed.mountId, true)).find((entry) => entry.kind === "file" && entry.path === parsed.path);
      if (!file) throw new AgentAssetError("unavailable", "图片不在已授权的目录中。");
      return { ...file, version: null, text: `图片：${file.name}\n图片内容通过图像接口按需读取。` };
    };
    adapters.push({
      id: "mounted-files", accepts: accepts("files"), context,
      resolveRelativeImages: relativeImages,
      async resolveImages(path, options) { const parsed = target(path); if (parsed.kind !== "external-file" || !/\.(png|jpe?g|gif|webp)$/i.test(parsed.path) || !files.readImage) return []; check(options?.signal); const image = await files.readImage(parsed.mountId, parsed.path); check(options?.signal); return [{ base64: image.base64, mediaType: image.mediaType, label: parsed.path.split("/").at(-1) ?? "图片" }]; },
      async search({ query, limit = 30, signal }) {
        const rows: AgentAsset[] = [];
        for (const mount of await files.listMounts()) {
          check(signal);
          for (const file of await files.listEntries(mount.id, true).catch(() => [])) {
            if (file.kind !== "file" || !/\.(md|markdown|canvas|png|jpe?g|gif|webp)$/i.test(file.path)) continue;
            const path = liteasyPath(scope, { kind: "external-file", mountId: mount.id, path: file.path });
            if (!`${file.name} ${file.path} ${path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
            const { revision: _revision, ...asset } = fileStat({ ...file, version: null, text: "" });
            rows.push({ ...asset, summary: mount.name });
            if (rows.length >= limit) return rows;
          }
        }
        return rows;
      },
      async stat(path) { return fileStat(await describeFile(path)); },
      async read(path, options) { const file = await describeFile(path); return readAgentAssetText(fileStat(file), file.text, options); },
      async write(path, options) {
        if (imageExtension.test(target(path).kind === "external-file" ? new URL(path).pathname : "")) throw new AgentAssetError("read_only", "图片支持读取与加入上下文，请创建派生笔记保存解释。" );
        const file = await fileSnapshot(path);
        if (/\.canvas$/i.test(file.path)) {
          if (options.mode !== "replace") throw new AgentAssetError("invalid_request", "Canvas 请使用 replace 写入完整文档。");
          parseCanvasFile(options.text);
        }
        if (!file.version || file.version !== options.expectedRevision) throw new AgentAssetError("revision_conflict", "文件已被其他编辑器修改，请重新读取。");
        const editing = await files.editingStatus?.(file.mountId, file.path);
        const after = options.mode === "append" ? file.text + options.text : options.text;
        check(options.signal);
        const next = after === file.text ? file : await files.writeFile({ mountId: file.mountId, path: file.path, text: after, expectedVersion: file.version });
        return { asset: fileStat(next), previousRevision: file.version, changed: next.version !== file.version,
          ...assetChangedLines(file.text, after), ...(editing?.editing ? { warnings: ["Obsidian 正在编辑这个文件，建议关闭对应标签页以避免后续冲突。"] } : {}) };
      },
    });
  }
  if (input.getPapers) {
    const paperStat = (paper: Paper): AgentAsset => ({ path: liteasyPath(scope, { kind: "paper", paperId: paper.id }),
      title: paper.literature?.title || paper.title, kind: "paper", revision: paper.contentHash,
      capabilities: readCapabilities(), relatedPaperIds: [paper.id],
      summary: [Array.isArray(paper.authors) ? paper.authors.join("、") : paper.authors, paper.year].filter(Boolean).join(" · "),
    });
    const findPaper = (path: string) => {
      const parsed = target(path);
      const paper = parsed.kind === "paper" ? input.getPapers!().find((item) => item.id === parsed.paperId) : undefined;
      if (!paper) throw new AgentAssetError("unavailable", "论文不在当前文献库中。");
      return paper;
    };
    const paperWithAbstract = async (paper: Paper) => {
      const asset = paperStat(paper);
      const abstract = await input.getPaperAbstract?.(paper);
      return { ...asset, summary: [asset.summary, abstract?.trim() ? `摘要：${abstract.trim().slice(0, 4000)}` : "摘要尚未提取；需要详情时按需读取正文。"].filter(Boolean).join("\n") };
    };
    adapters.push({ id: "papers", accepts: accepts("papers"), context,
      async search({ query, limit = 30 }) {
        return input.getPapers!().map(paperStat).filter((paper) => `${paper.title} ${paper.summary} ${paper.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit);
      },
      async stat(path) { return paperWithAbstract(findPaper(path)); },
      async read(path, options) {
        const paper = findPaper(path);
        const text = input.readPaper ? await input.readPaper(paper, options) : `# ${paperStat(paper).title}\n\n${paperStat(paper).summary}\n\n当前仅有题录；请先在阅读器中解析论文正文。`;
        return readAgentAssetText(paperStat(paper), text, options);
      },
    });
  }
  if (input.getArtifacts) {
    const artifactStat = (artifact: AgentArtifactResult, revision?: string): AgentAsset => ({
      path: liteasyPath(scope, { kind: "artifact", artifactId: artifact.artifactId }), title: artifact.title,
      kind: `artifact.${artifact.artifactType}`, revision, capabilities: readCapabilities(), relatedPaperIds: artifact.papers.map((paper) => paper.id),
    });
    const findArtifact = async (path: string) => {
      const parsed = target(path);
      const artifact = parsed.kind === "artifact" ? (await input.getArtifacts!()).find((item) => item.artifactId === parsed.artifactId) : undefined;
      if (!artifact) throw new AgentAssetError("unavailable", "生成产物不可用。");
      return artifact;
    };
    adapters.push({ id: "artifacts", accepts: accepts("agent-artifacts"), context,
      async search({ query, limit = 30 }) {
        const candidates: AgentAsset[] = input.getArtifactTitles ? input.getArtifactTitles().map((artifact) => ({
          path: liteasyPath(scope, { kind: "artifact", artifactId: artifact.artifactId }), title: artifact.title,
          kind: "artifact", capabilities: readCapabilities(),
        })) : (await input.getArtifacts!()).map((artifact) => artifactStat(artifact));
        return candidates
          .filter((artifact) => `${artifact.title} ${artifact.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit);
      },
      async stat(path) { const artifact = await findArtifact(path); return artifactStat(artifact, await resourceContentRevision(canonicalResourceJson(artifact))); },
      async read(path, options) { const artifact = await findArtifact(path); return readAgentAssetText(artifactStat(artifact, await resourceContentRevision(canonicalResourceJson(artifact))), artifactContextText(artifact), options); },
    });
  }
  return createAgentAssetService({ scopeId: scope, active: input.active, adapters,
    async create(options) {
      check(options.signal);
      if (options.paperPath) {
        const parsed = target(options.paperPath);
        const paper = parsed.kind === "paper" ? input.getPapers?.().find((item) => item.id === parsed.paperId) : undefined;
        if (!paper || !input.projects) throw new AgentAssetError("invalid_path", "请选择当前文献库中的论文路径。");
        const project = await input.projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
        check(options.signal);
        const asset = options.kind === "note"
          ? await input.projects.createNote(project.projectId, options.text ?? "", options.title, [], `mcp:${options.operationId}`)
          : await input.projects.createBoard(project.projectId, options.title, `mcp:${options.operationId}`);
        return objectStat(await input.repository.resolveLatest(asset.ref!.objectId));
      }
      const object = await input.repository.create(options.kind === "note"
        ? { kind: "content.note", title: options.title, content: { schema: "liteasy.note/v1", payload: { text: options.text ?? "", origin: "user" } } }
        : { kind: "workspace.board", title: options.title, content: { schema: "liteasy.board/v1", payload: { description: "" } } }, `mcp-create:${options.operationId}`);
      return objectStat(await input.repository.resolveLatest(object.objectId));
    },
  });
}
