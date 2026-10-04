import { createObjectRepository } from "../objects/objectRepository";
import { assetDescriptor, stageImage, type StagedObjectAsset } from "../objects/objectAssets";
import { ObjectStoreError, objectText, refOf, type ObjectRef } from "../objects/object.types";
import type { ObjectStorage, StorageChange, StorageRow } from "../objects/objectStorage";
import { paperAnchorFromEvidence } from "../paper-anchors/paperAnchorEntity";
import {
  paperProjectAssetSchema,
  paperProjectSchema,
  type PaperProject,
  type PaperProjectAsset,
  type PaperProjectSourceInput,
} from "./paperProject.types";

const change = (key: string, value: unknown, previous?: StorageRow | null): StorageChange => ({
  key,
  expected: previous?.version ?? null,
  row: { key, version: crypto.randomUUID(), value },
});
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function conflict(error: unknown) {
  return error instanceof ObjectStoreError && error.code === "revision_conflict";
}
function unavailable(): never {
  throw new ObjectStoreError("object_not_found", "论文项目在当前账号不可用。");
}

/** Projects store only membership and display metadata; bodies and images stay in the object store. */
export function createPaperProjectRepository(storage: ObjectStorage, scopeId: string) {
  const objects = createObjectRepository(storage, scopeId);
  const projectKey = (projectId: string) => `paper-project/project/${encodeURIComponent(projectId)}`;
  const assetPrefix = (projectId: string) => `paper-project/asset/${encodeURIComponent(projectId)}/`;
  async function listRows(prefix: string) {
    const rows: StorageRow[] = [];
    let cursor = "";
    do {
      const batch = await storage.list(prefix, cursor, 500);
      rows.push(...batch);
      cursor = batch.length === 500 ? batch.at(-1)!.key : "";
    } while (cursor);
    return rows;
  }
  async function getProject(projectId: string) {
    const row = await storage.get(projectKey(projectId));
    if (!row) unavailable();
    const project = paperProjectSchema.parse(row.value);
    if (project.scopeId !== scopeId || project.projectId !== projectId) unavailable();
    return { row, project };
  }
  async function ensurePaperProject(input: { paperId: string; title: string }): Promise<PaperProject> {
    const projectId = `paper:${await digest([scopeId, input.paperId])}`;
    const key = projectKey(projectId);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const previous = await storage.get(key);
      const current = previous ? paperProjectSchema.parse(previous.value) : undefined;
      if (current && current.scopeId !== scopeId) unavailable();
      const now = new Date().toISOString();
      const project = paperProjectSchema.parse({
        schemaVersion: "liteasy.paper-project/v1",
        projectId,
        paperId: input.paperId,
        scopeId,
        title: input.title.trim() || "未命名论文",
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
      if (current?.title === project.title) return current;
      try {
        await storage.commit([change(key, project, previous)]);
        return project;
      } catch (error) {
        if (!conflict(error) || attempt === 7) throw error;
      }
    }
    throw new ObjectStoreError("revision_conflict", "项目已变化，请重新打开。");
  }
  async function listProjects(): Promise<PaperProject[]> {
    return (await listRows("paper-project/project/"))
      .map((row) => paperProjectSchema.parse(row.value))
      .filter((project) => project.scopeId === scopeId)
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  async function listAssets(projectId: string): Promise<PaperProjectAsset[]> {
    await getProject(projectId);
    return (await listRows(assetPrefix(projectId))).map((row) => paperProjectAssetSchema.parse(row.value));
  }
  async function validateAsset(project: PaperProject, input: PaperProjectAsset) {
    const asset = paperProjectAssetSchema.parse(input);
    const object = asset.ref ? await objects.get(asset.ref) : undefined;
    if (asset.role === "source") {
      if (object?.kind !== "source.document" || object.content.payload.paperId !== project.paperId) {
        throw new ObjectStoreError("capability_denied", "来源必须是本论文的识别内容；其他论文内容请作为引用添加。");
      }
      if (asset.kind === "image" && !object.assets.some((item) => item.mediaType.startsWith("image/"))) {
        throw new ObjectStoreError("capability_denied", "原图尚未保存，请等待图片识别完成。");
      }
    }
    if (asset.role === "derived" && object?.kind === "source.document") {
      throw new ObjectStoreError("capability_denied", "论文原文和原图不可直接修改，请创建可编辑副本。");
    }
    return asset;
  }
  async function writeAsset(projectId: string, input: PaperProjectAsset, syncSource = false): Promise<PaperProjectAsset> {
    const { project } = await getProject(projectId);
    const asset = await validateAsset(project, input);
    const key = `${assetPrefix(projectId)}${encodeURIComponent(asset.assetId)}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { row: projectRow, project: currentProject } = await getProject(projectId);
      const previous = await storage.get(key);
      const current = previous ? paperProjectAssetSchema.parse(previous.value) : undefined;
      if (JSON.stringify(current) === JSON.stringify(asset)) return current!;
      if (current?.role === "source" && (!syncSource || asset.role !== "source" || current.ref?.objectId !== asset.ref?.objectId)) {
        throw new ObjectStoreError("capability_denied", "论文来源只读，请创建可编辑副本。");
      }
      if (current && current.role !== "source" && asset.role === "source") {
        throw new ObjectStoreError("capability_denied", "已有资产不能改为论文来源，请使用新的资产标识。");
      }
      try {
        await storage.commit([
          change(key, asset, previous),
          change(projectKey(projectId), { ...currentProject, updatedAt: new Date().toISOString() }, projectRow),
        ]);
        return asset;
      } catch (error) {
        if (!conflict(error) || attempt === 7) throw error;
      }
    }
    throw new ObjectStoreError("revision_conflict", "项目资产已变化，请刷新后重试。");
  }
  async function addAsset(projectId: string, asset: PaperProjectAsset) {
    return writeAsset(projectId, asset);
  }
  /** Add newly recognized sources without deleting old sources or user-created work. */
  async function syncSources(projectId: string, assets: PaperProjectAsset[]) {
    const { project } = await getProject(projectId);
    const seen = new Set<string>();
    for (const asset of assets) {
      if (asset.role !== "source" || seen.has(asset.assetId)) {
        throw new ObjectStoreError("capability_denied", "同步来源需要互不重复的原文或原图引用。");
      }
      seen.add(asset.assetId);
      await validateAsset(project, asset);
    }
    const result: PaperProjectAsset[] = [];
    for (const asset of assets) result.push(await writeAsset(projectId, asset, true));
    return result;
  }
  async function persistImage(asset: StagedObjectAsset) {
    // Validate both the bytes and their hash before creating an immutable source attachment.
    const verified = await stageImage(Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0)), asset.mediaType);
    if (verified.assetId !== asset.assetId || verified.sha256 !== asset.sha256 || verified.byteLength !== asset.byteLength) {
      throw new ObjectStoreError("unsupported_schema", "图片校验失败，来源未保存。");
    }
    const key = `asset/${asset.assetId}`;
    const existing = await storage.get(key);
    if (existing) {
      const stored = existing.value as StagedObjectAsset;
      if (stored.sha256 !== asset.sha256 || stored.base64 !== verified.base64) {
        throw new ObjectStoreError("revision_conflict", "原图与已保存的图片不一致。");
      }
      return;
    }
    try {
      await storage.commit([change(key, verified)]);
    } catch (error) {
      if (!conflict(error)) throw error;
      const raced = await storage.get(key);
      if ((raced?.value as StagedObjectAsset | undefined)?.base64 !== verified.base64) throw error;
    }
  }
  async function registerSource(projectId: string, input: PaperProjectSourceInput): Promise<PaperProjectAsset> {
    const { project } = await getProject(projectId);
    if (input.paperId !== project.paperId) {
      throw new ObjectStoreError("capability_denied", "来源不属于这篇论文，请作为跨项目引用添加。");
    }
    // Validate lightweight fields before writing any body or binary asset.
    paperProjectAssetSchema.parse({
      assetId: input.assetId,
      title: input.title,
      kind: input.kind,
      role: "source",
      ref: { objectId: "pending", revision: "pending" },
      ...(input.page !== undefined ? { page: input.page } : {}),
    });
    const sourceId = await digest([projectId, input.assetId]);
    const legacyKey = `project-source:${sourceId}`;
    const paperAnchor = paperAnchorFromEvidence({
      id: `evidence-project-${sourceId}`,
      paperId: input.paperId,
      paperTitle: project.title,
      page: input.page,
      quote: input.text,
    });
    if (input.documentHash) paperAnchor.source.documentHash = input.documentHash;
    if (input.kind === "image" && !input.assets?.length) {
      throw new ObjectStoreError("capability_denied", "原图尚未保存，请等待图片识别完成。");
    }
    for (const asset of input.assets ?? []) await persistImage(asset);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const source = await objects.projectLegacy(legacyKey, {
          kind: "source.document",
          title: input.title,
          assets: (input.assets ?? []).map(assetDescriptor),
          paperAnchors: [paperAnchor],
          content: {
            schema: "liteasy.source-document/v1",
            payload: {
              paperId: input.paperId,
              text: input.text,
              ...(input.page ? { pages: [{ page: input.page, text: input.text }] } : {}),
              ...(input.documentHash ? { documentHash: input.documentHash } : {}),
              availability: "local",
              legacyKey,
            },
          },
        });
        return writeAsset(projectId, {
          assetId: input.assetId,
          title: input.title,
          kind: input.kind,
          role: "source",
          ref: refOf(source),
          ...(input.page ? { page: input.page } : {}),
          description: input.kind === "image" ? "论文原图 · 只读来源，修改时创建副本" : "识别原文 · 只读来源，修改时创建副本",
        }, true);
      } catch (error) {
        if (!conflict(error) || attempt === 7) throw error;
      }
    }
    throw new ObjectStoreError("revision_conflict", "论文来源已变化，请重试。");
  }
  async function createEditableCopy(projectId: string, sourceRef: ObjectRef, title?: string, operationId?: string): Promise<PaperProjectAsset> {
    await getProject(projectId);
    const source = await objects.get(sourceRef);
    const copyTitle = title?.trim() || `${source.title}（可编辑副本）`.slice(0, 1000);
    const operation = operationId ?? await digest([projectId, sourceRef, copyTitle]);
    const note = await objects.create({
      kind: "content.note",
      title: copyTitle,
      assets: source.assets,
      paperAnchors: source.paperAnchors,
      sourceRefs: [sourceRef],
      derivedFrom: [sourceRef],
      content: {
        schema: "liteasy.note/v1",
        payload: { text: objectText(source), origin: "derived", assetIds: source.assets.map((asset) => asset.assetId) },
      },
    }, `paper-project-copy:${projectId}:${operation}`);
    return addAsset(projectId, {
      assetId: `object:${note.objectId}`,
      title: note.title,
      kind: "note",
      role: "derived",
      ref: refOf(note),
      description: `来自「${source.title}」的独立副本，修改不会改变论文来源。`.slice(0, 12000),
    });
  }
  async function createNote(projectId: string, text: string, title = "项目笔记", sourceRefs: ObjectRef[] = [], operationId: string = crypto.randomUUID(), runId?: string): Promise<PaperProjectAsset> {
    await getProject(projectId);
    const note = await objects.create({
      kind: "content.note",
      title: title.trim() || "项目笔记",
      runId,
      sourceRefs,
      ...(sourceRefs.length ? { derivedFrom: sourceRefs } : {}),
      content: { schema: "liteasy.note/v1", payload: { text, origin: sourceRefs.length ? "derived" : "user" } },
    }, `paper-project-note:${projectId}:${operationId}`);
    const latest = await objects.resolveLatest(note.objectId);
    return addAsset(projectId, {
      assetId: `object:${note.objectId}`,
      title: latest.title,
      kind: "note",
      role: "derived",
      ref: refOf(latest),
    });
  }
  async function createBoard(projectId: string, title = "论文白板", operationId: string = crypto.randomUUID(), sourceRefs: ObjectRef[] = []): Promise<PaperProjectAsset> {
    await getProject(projectId);
    const board = await objects.create({ kind: "workspace.board", sourceRefs, title: title.trim() || "论文白板",
      content: { schema: "liteasy.board/v1", payload: { description: "" } } }, `paper-project-board:${projectId}:${operationId}`);
    const latest = await objects.resolveLatest(board.objectId);
    return addAsset(projectId, { assetId: `object:${board.objectId}`, title: latest.title, kind: "board", role: "derived", ref: refOf(latest) });
  }
  return { ensurePaperProject, listProjects, listAssets, syncSources, addAsset, registerSource, createEditableCopy, createNote, createBoard };
}

export type PaperProjectRepository = ReturnType<typeof createPaperProjectRepository>;
export type { PaperProject, PaperProjectAsset, PaperProjectSourceInput } from "./paperProject.types";
