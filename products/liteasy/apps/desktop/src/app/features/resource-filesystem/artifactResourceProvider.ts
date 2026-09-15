import { parseAuthoredArtifact } from "../artifact-workflow/authoredArtifact";
import { createArtifactMarkdown } from "../artifacts/artifactDocumentExport";
import type { AgentArtifactResult, ArtifactTab } from "../artifacts/artifact.types";
import { isArtifactResult, type ArtifactResultClient } from "../artifacts/artifactResultClient";
import { sha256Hex } from "../paper-identity/paperIdentity";
import { paperAnchorsForArtifact } from "../paper-anchors/paperAnchorAdapters";
import { authoredResourceMarkdown, createAuthoredResourceFile } from "./authoredResourceFile";
import {
  ResourceFileError,
  type ResourceListOptions,
  type ResourceProvider,
  type ResourceReadOptions,
  type ResourceRef,
  type ResourceScope,
  type ResourceStat
} from "./resourceFile.types";
import { assertResourceScope, awaitResourceRead, createResourceFileService, resourceUri } from "./resourceFileService";
import { canonicalResourceJson, maximumResourceBytes, resourceContentRevision, resourceFileStem } from "./resourceFileContent";

export function artifactResourceScope(confirmedAccountScopeKey?: string): ResourceScope {
  return confirmedAccountScopeKey
    ? { id: `account-${sha256Hex(confirmedAccountScopeKey)}`, kind: "account" }
    : { id: "device", kind: "device" };
}

type ArtifactProviderInput = {
  client: ArtifactResultClient;
  scope: ResourceScope;
  getCurrentScopeId?: () => string;
};

function artifactFiles(document: AgentArtifactResult, canonicalDocument: string) {
  const authored = document.authoredArtifact ? parseAuthoredArtifact(document.authoredArtifact) : undefined;
  const tab: ArtifactTab = { ...document, type: document.artifactType };
  const nativeFile = authored ? createAuthoredResourceFile({ artifactId: document.artifactId, content: authored,
    paperAnchors: paperAnchorsForArtifact(tab), contextRefs: document.sourceContextRefs }) : undefined;
  const markdown = nativeFile
    ? authoredResourceMarkdown(nativeFile)
    : createArtifactMarkdown(tab, { includeExportedAt: false });
  const native = nativeFile ? canonicalResourceJson(nativeFile) : canonicalDocument;
  const stem = resourceFileStem(document.title);
  return [
    { representation: "native" as const, content: native, fileName: `${stem}.${authored?.kind === "slides" ? "slides" : authored?.kind === "outline" ? "outline" : "artifact"}.json`, mediaType: "application/json" },
    { representation: "markdown" as const, content: markdown, fileName: `${stem}.md`, mediaType: "text/markdown" }
  ];
}

export function createArtifactResourceProvider(input: ArtifactProviderInput) {
  const boundary = { scope: { ...input.scope }, getCurrentScopeId: input.getCurrentScopeId };
  const check = (signal?: AbortSignal) => assertResourceScope(boundary, signal);
  async function describe(document: AgentArtifactResult, ref?: ResourceRef, canonicalDocument = canonicalResourceJson(document)) {
    if (!isArtifactResult(document)) throw new ResourceFileError("invalid_content", "产物格式无效，无法作为资源打开。");
    const revision = await resourceContentRevision(canonicalDocument);
    if (ref?.revision && ref.revision !== revision) {
      throw new ResourceFileError("revision_unavailable", "此产物已变更，旧版本未单独保存；请重新选择当前版本。");
    }
    const canonicalRef = { providerId: "artifacts", resourceId: document.artifactId, scopeId: boundary.scope.id, revision };
    const files = artifactFiles(document, canonicalDocument);
    const resource: ResourceStat = {
      protocolVersion: "liteasy.resource-file/v1",
      canonicalRef,
      canonicalUri: resourceUri(canonicalRef),
      title: document.title,
      kind: document.authoredArtifact?.kind ?? document.artifactType,
      scope: { ...boundary.scope },
      availability: "available",
      versioning: "snapshot_required",
      effectiveCapabilities: ["stat", "list", "read", "save"],
      files: files.map(({ content, ...file }) => ({ ...file, byteLength: new TextEncoder().encode(content).byteLength }))
    };
    return { resource, files };
  }
  async function listDocuments(signal?: AbortSignal) {
    check(signal);
    const documents = await awaitResourceRead(input.client.list(signal), signal);
    check(signal);
    return documents;
  }
  async function getDocument(ref: ResourceRef, signal?: AbortSignal) {
    check(signal);
    if (ref.scopeId !== boundary.scope.id || ref.providerId !== "artifacts") {
      throw new ResourceFileError("resource_unavailable", "资源不可用。");
    }
    // Legacy clients expose a full catalog, not byte streams or per-record GETs.
    const document = (await listDocuments(signal)).find((entry) => entry.artifactId === ref.resourceId);
    if (!document) throw new ResourceFileError("resource_unavailable", "资源不可用。");
    return document;
  }
  const provider: ResourceProvider = {
    ...boundary,
    providerId: "artifacts",
    async stat(ref, options = {}) {
      const { resource } = await describe(await getDocument(ref, options.signal), ref);
      check(options.signal);
      return resource;
    },
    async list(options: ResourceListOptions = {}) {
      const limit = options.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new ResourceFileError("invalid_cursor", "每页资源数必须在 1 至 100 之间。");
      }
      if (options.cursor && options.cursor.length > 2048) throw new ResourceFileError("invalid_cursor", "资源分页游标过长。");
      const documents = (await listDocuments(options.signal)).slice().sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.artifactId.localeCompare(right.artifactId));
      const catalogRevision = await resourceContentRevision(JSON.stringify(documents.map((document) =>
        [document.artifactId, document.createdAt, document.title])));
      let offset = 0;
      if (options.cursor) {
        let cursor: { scopeId?: unknown; catalogRevision?: unknown; offset?: unknown };
        try { cursor = JSON.parse(decodeURIComponent(options.cursor)); }
        catch { throw new ResourceFileError("invalid_cursor", "资源分页游标无效，请重新加载。"); }
        if (!cursor || cursor.scopeId !== boundary.scope.id || cursor.catalogRevision !== catalogRevision ||
          typeof cursor.offset !== "number" || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > documents.length) {
          throw new ResourceFileError("invalid_cursor", "资源目录已变化或所属范围不匹配，请重新加载。");
        }
        offset = cursor.offset;
      }
      const entries: ResourceStat[] = [];
      for (const document of documents.slice(offset, offset + limit)) {
        check(options.signal);
        entries.push((await describe(document)).resource);
      }
      check(options.signal);
      const nextOffset = offset + entries.length;
      return { entries, consistency: "latest" as const, ...(nextOffset < documents.length ? {
        nextCursor: encodeURIComponent(JSON.stringify({ scopeId: boundary.scope.id, catalogRevision, offset: nextOffset }))
      } : {}) };
    },
    async read(ref, options: ResourceReadOptions) {
      if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > maximumResourceBytes) {
        throw new ResourceFileError("read_limit_exceeded", "读取上限必须在 1 字节至 12 MiB 之间。");
      }
      const document = await getDocument(ref, options.signal);
      const { resource, files } = await describe(document, ref);
      check(options.signal);
      const file = files.find((candidate) => candidate.representation === options.representation);
      if (!file) throw new ResourceFileError("unsupported_representation", "该资源不支持所请求的文件格式。");
      const byteLength = new TextEncoder().encode(file.content).byteLength;
      if (byteLength > options.maxBytes) throw new ResourceFileError("read_limit_exceeded", "资源内容超过本次读取上限，请调整读取范围。");
      return { resource, ...file, byteLength, encoding: "utf8" as const };
    }
  };
  return {
    ...provider,
    async saveArtifact(document: AgentArtifactResult, options: { signal?: AbortSignal } = {}) {
      check(options.signal);
      // Match the existing formal API's normalization, also for the local adapter.
      const normalized = { ...document, title: document.title.normalize("NFKC").trim() };
      const canonicalDocument = canonicalResourceJson(normalized);
      const snapshot: AgentArtifactResult = JSON.parse(canonicalDocument);
      const { resource } = await describe(snapshot, undefined, canonicalDocument);
      check(options.signal);
      const resultPath = await input.client.save(snapshot, options.signal);
      // A successful storage receipt cannot be undone by a late cancellation.
      // Keep the committed scope separate from permission to publish in the UI.
      const publishable = !boundary.getCurrentScopeId || boundary.getCurrentScopeId() === boundary.scope.id;
      return { status: "saved" as const, publishable, resultPath, resource };
    }
  };
}

export function createArtifactResourceService(input: ArtifactProviderInput) {
  const provider = createArtifactResourceProvider(input);
  return { ...createResourceFileService([provider]), saveArtifact: provider.saveArtifact };
}
