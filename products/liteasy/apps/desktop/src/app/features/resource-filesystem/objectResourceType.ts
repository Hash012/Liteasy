import { refOf, type ObjectEnvelope } from "../objects/object.types";
import type { ObjectRepository } from "../objects/objectRepository";
import { liteasyPath } from "./liteasyPath";
import { parseResourceUri, resourceUri } from "./resourceFileService";
import { ResourceFileError, type ResourceProvider, type ResourceRef, type ResourceStat } from "./resourceFile.types";
import type { AgentAssetAdapter } from "./agentAsset.types";
import { providerAssetSource, type ResourceTypeDefinition } from "./resourceTypeRegistry";
import { readAgentAssetText } from "./agentAssetService";
import { canonicalResourceJson } from "./resourceFileContent";

/** Object type registration reuses its authoritative repository and existing permission-aware adapter. */
export function objectResourceType(input: {
  typeId: string; kind: ObjectEnvelope["kind"]; repository: ObjectRepository; adapter: AgentAssetAdapter;
  active(): boolean; fixtureId: string;
}): ResourceTypeDefinition {
  const { repository, adapter, typeId } = input;
  const check = () => { if (!input.active()) throw new ResourceFileError("scope_changed", "账号已切换。"); };
  const resolve = async (ref: ResourceRef) => {
    check();
    if (ref.scopeId !== repository.scopeId) throw new ResourceFileError("scope_changed", "资源不属于当前账号。");
    const object = ref.revision ? await repository.get({ objectId: ref.resourceId, revision: ref.revision }) : await repository.resolveLatest(ref.resourceId);
    check();
    if (object.kind !== input.kind || object.lifecycle !== "active") throw new ResourceFileError("resource_unavailable", "资源类型不匹配或已删除。");
    return object;
  };
  const address = (object: ObjectEnvelope) => liteasyPath(repository.scopeId, { kind: "object", ref: refOf(object) });
  const refForPath = (path: string): ResourceRef => {
    const ref = parseResourceUri(path);
    if (ref.providerId !== typeId || ref.scopeId !== repository.scopeId) throw new ResourceFileError("invalid_ref", "资源地址与注册类型不匹配。");
    return { ...ref, scopeId: repository.scopeId };
  };
  const stat = async (ref: ResourceRef): Promise<ResourceStat> => {
    const object = await resolve(ref);
    const legacy = await adapter.stat(address(object));
    check();
    const canonicalRef = { providerId: typeId, resourceId: object.objectId, scopeId: repository.scopeId, revision: object.revision };
    return { protocolVersion: "liteasy.resource-file/v1", canonicalRef, canonicalUri: resourceUri(canonicalRef), title: object.title, kind: typeId,
      scope: { id: repository.scopeId, kind: "account" }, availability: "available", versioning: "snapshot_required",
      effectiveCapabilities: ["stat", "list", "read", ...(legacy.capabilities.includes("write") ? ["save" as const] : [])], files: [] };
  };
  const provider: ResourceProvider = { providerId: typeId, scope: { id: repository.scopeId, kind: "account" }, getCurrentScopeId: () => input.active() ? repository.scopeId : "inactive",
    stat,
    async list(options = {}) {
      check();
      const rows = (await repository.searchTitles("", 1000)).filter(row => row.kind === input.kind);
      const offset = Number(options.cursor ?? 0), limit = Math.min(100, options.limit ?? 30);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new ResourceFileError("invalid_cursor", "分页游标无效。");
      const entries = await Promise.all(rows.slice(offset, offset + limit).map(row => stat({ providerId: typeId, scopeId: repository.scopeId, resourceId: row.objectId, revision: row.revision })));
      check(); return { entries, consistency: "latest", ...(offset + limit < rows.length ? { nextCursor: String(offset + limit) } : {}) };
    },
    async read(ref, options) {
      const object = await resolve(ref);
      const resource = await stat({ ...ref, revision: object.revision });
      const projection = options.representation === "markdown" ? await adapter.read(address(object), { maxCharacters: 80000, signal: options.signal }) : undefined;
      if (projection?.truncated) throw new ResourceFileError("read_limit_exceeded", "完整投影超过读取预算，请使用分页读取。");
      if (object.kind === "workspace.board" && (await repository.resolveLatest(object.objectId)).revision !== object.revision) throw new ResourceFileError("revision_unavailable", "白板布局历史快照不可用。");
      const content = options.representation === "native" ? canonicalResourceJson(object.kind === "workspace.board"
        ? { schema: "liteasy.board-bundle/v1", object, placements: await repository.listPlacements(object.objectId), edges: await repository.listEdges(object.objectId) } : object) : projection!.text;
      const byteLength = new TextEncoder().encode(content).byteLength;
      if (byteLength > options.maxBytes) throw new ResourceFileError("read_limit_exceeded", "完整内容超过读取预算。");
      check(); return { resource, representation: options.representation, fileName: `${object.objectId}.${options.representation === "native" ? "json" : "md"}`,
        mediaType: options.representation === "native" ? "application/json" : "text/markdown", byteLength, encoding: "utf8", content };
    },
  };
  const source = providerAssetSource(provider, (text, asset, options) => readAgentAssetText(asset, text, options));
  const baseStat = source.stat;
  source.stat = async (path, options) => {
    const object = await resolve(refForPath(path));
    const legacy = await adapter.stat(address(object), options);
    return { ...legacy, ...await baseStat(path, options) };
  };
  // Read via the existing domain projection (Canvas/source restrictions included), then rebind canonical identity.
  source.read = async (path, options) => {
    const object = await resolve(refForPath(path));
    const legacy = await adapter.read(address(object), options);
    const asset = { ...legacy.asset, path: resourceUri({ providerId: typeId, resourceId: object.objectId, scopeId: repository.scopeId, revision: object.revision }), kind: typeId };
    return { ...legacy, asset, ...(legacy.content ? { content: { ...legacy.content, binding: { kind: "pinned" as const, path: asset.path, revision: object.revision, scopeId: repository.scopeId }, representationId: `${asset.path}:text/v1` } } : {}) };
  };
  return { typeId, schemaVersion: 1, owner: "ObjectRepository", nativeCodec: input.kind === "workspace.board" ? "liteasy.board-bundle/v1" : "liteasy.object/v1", profile: "liteasy-research-markdown/v1", viewId: "content", fixtureIds: [input.fixtureId], source,
    file: { supported: true, implementation: provider },
    navigation: { supported: true, implementation: async path => { const object = await resolve(refForPath(path)); return { path: address(object), revision: object.revision, scopeId: repository.scopeId }; } },
    context: adapter.context ? { supported: true, implementation: async path => adapter.context!(address(await resolve(refForPath(path)))) } : { supported: false, reason: "当前环境未提供上下文入口" },
    write: adapter.write && input.kind === "content.note" ? { supported: true, implementation: async (path, options) => {
      const object = await resolve(refForPath(path));
      const receipt = await adapter.write!(address(object), options);
      check(); return { ...receipt, asset: { ...receipt.asset, path: resourceUri({ providerId: typeId, resourceId: object.objectId, scopeId: repository.scopeId, revision: receipt.asset.revision }), kind: typeId } };
    } } : { supported: false, reason: "此类型通过专用编辑器保存原生结构" },
  };
}
