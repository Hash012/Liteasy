import { loadStoredAccountSession } from "../account/accountSessionStorage";
import { CloudServiceError, readCloudServiceError } from "../network/cloudErrorMessage";
import { cacheExternalPdf, readCachedPdf } from "./paperCacheClient";
import { resolveLocalAccountKey } from "./localAccountKey";
import type { OrganizationStorageAccess } from "../organization/organizationStoragePolicy";
import type { LiteratureRecord } from "../paper-identity/literature.types";

export type CloudLibraryScope = {
  scopeId: string;
  scopeType: "organization" | "user";
};

export type CloudLibraryDocument = CloudLibraryScope & {
  byteLength: number;
  contentHash: string;
  createdAt: string;
  documentId: string;
  entryKind: "pdf";
  fileName: string;
  folderId?: string;
  metadata?: Record<string, unknown>;
  purgeAfter?: string;
  status: "active" | "trashed";
  trashedAt?: string;
  updatedAt: string;
  uploadedBy: string;
  title: string;
};

export type CloudLibraryMetadataEntry = CloudLibraryScope & {
  createdAt: string;
  documentId: string;
  doi?: string;
  entryKind: "metadata_only";
  externalUrl?: string;
  folderId?: string;
  metadata?: Record<string, unknown>;
  purgeAfter?: string;
  sourceId?: string;
  status: "active" | "trashed";
  title: string;
  trashedAt?: string;
  updatedAt: string;
};

export type CloudLibraryEntry = CloudLibraryDocument | CloudLibraryMetadataEntry;

export type CloudLibraryFolder = {
  createdAt: string;
  folderId: string;
  name: string;
  parentFolderId?: string;
  purgeAfter?: string;
  status: "active" | "trashed";
  trashedAt?: string;
  updatedAt: string;
};

export type CloudLibraryTree = CloudLibraryScope & {
  entries: CloudLibraryEntry[];
  folders: CloudLibraryFolder[];
  revision: number;
};

export type CloudLibraryQuota = CloudLibraryScope & {
  availableBytes: number;
  limitBytes: number;
  usedBytes: number;
};

export type CloudLibraryUploadResult = {
  contentHash?: string;
  document?: CloudLibraryDocument;
  duplicates: CloudLibraryDocument[];
  revision?: number;
  status: "cancelled" | "duplicate" | "imported";
};

type CachedCloudDocument = {
  cachePath: string;
  contentHash: string;
  expiresAt: string;
  lastAccessedAt: string;
  serverNow: string;
};

type CreateCloudLibraryStorageClientInput = {
  endpoint: string;
  fetchImpl?: typeof fetch;
};

function apiUrl(endpoint: string, path: string) {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

function requireSessionId() {
  const sessionId = loadStoredAccountSession()?.sessionId;
  if (!sessionId) throw new Error("请先登录，再访问云端文献库。");
  return sessionId;
}

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function cacheRecordKey(scope: CloudLibraryScope, documentId: string) {
  return [
    "liteasy.cloud-document-cache.v1",
    resolveLocalAccountKey(),
    scope.scopeType,
    scope.scopeId,
    documentId
  ].map(encodeURIComponent).join("::");
}

function loadCacheRecord(scope: CloudLibraryScope, documentId: string) {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  const value = window.localStorage.getItem(cacheRecordKey(scope, documentId));
  if (!value) return undefined;
  try {
    const record = JSON.parse(value) as CachedCloudDocument;
    return typeof record.cachePath === "string" && typeof record.contentHash === "string"
      ? record
      : undefined;
  } catch {
    return undefined;
  }
}

function saveCacheRecord(
  scope: CloudLibraryScope,
  documentId: string,
  record: CachedCloudDocument
) {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(cacheRecordKey(scope, documentId), JSON.stringify(record));
}

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await readCloudServiceError(response, {
      code: "cloud_library_request_failed",
      message: "云端文献库请求未完成，请稍后重试。"
    });
  }
  return await response.json() as T;
}

export function createCloudLibraryStorageClient({
  endpoint,
  fetchImpl = fetch
}: CreateCloudLibraryStorageClientInput) {
  async function request(url: string, init: RequestInit) {
    try {
      return await fetchImpl(url, init);
    } catch {
      throw new CloudServiceError({
        code: "cloud_library_unavailable",
        message: "云端文献库暂时无法连接，请检查网络后重试。",
        status: 0
      });
    }
  }

  function authorizationError(error: unknown) {
    const prefix = "必须联网重新校验文献库权限，当前无法打开该文献。";
    if (error instanceof CloudServiceError) {
      return new CloudServiceError({
        code: error.code,
        message: `${prefix}${error.message}`,
        status: error.status,
        ...(error.traceId ? { traceId: error.traceId } : {})
      });
    }
    return new CloudServiceError({
      code: "library_authorization_unavailable",
      message: `${prefix}请检查登录状态和网络连接后重试。`,
      status: 0
    });
  }

  function jsonHeaders(sessionId = requireSessionId()) {
    return {
      Authorization: `Bearer ${sessionId}`,
      "Content-Type": "application/json"
    };
  }

  async function post<T>(path: string, scope: CloudLibraryScope, body: Record<string, unknown> = {}) {
    const sessionId = requireSessionId();
    const response = await request(apiUrl(endpoint, path), {
      body: JSON.stringify({ ...body, ...scope, sessionId }),
      headers: jsonHeaders(sessionId),
      method: "POST"
    });
    return jsonResponse<T>(response);
  }

  async function requestDocumentDownload(
    scope: CloudLibraryScope,
    documentId: string,
    mode: "download" | "export"
  ) {
    if (mode === "download") {
      try {
        await post("/v1/library/documents/authorize", scope, { documentId });
      } catch (error) {
        throw authorizationError(error);
      }
    }
    const sessionId = requireSessionId();
    const response = await request(apiUrl(
      endpoint,
      mode === "export"
        ? "/v1/library/documents/export"
        : "/v1/library/documents/download"
    ), {
      body: JSON.stringify({ ...scope, documentId, sessionId }),
      headers: jsonHeaders(sessionId),
      method: "POST"
    });
    if (!response.ok) {
      throw await readCloudServiceError(response, {
        code: mode === "export" ? "library_export_failed" : "library_download_failed",
        message: `${mode === "export" ? "文献出库" : "文献下载"}失败，请稍后重试。`
      });
    }
    if (!response.body) throw new Error("文献下载响应不包含可读取的数据流。");
    return response.body;
  }

  async function uploadOnce(
    scope: CloudLibraryScope,
    file: File,
    folderId?: string,
    duplicateAction?: "cancel" | "save_copy",
    expectedRevision?: number
  ) {
    const sessionId = requireSessionId();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${sessionId}`,
      "Content-Type": "application/pdf",
      "X-Liteasy-File-Name": encodeURIComponent(file.name),
      "X-Liteasy-Scope-Id": scope.scopeId,
      "X-Liteasy-Scope-Type": scope.scopeType,
      "X-Liteasy-Session-Id": sessionId
    };
    headers["X-Idempotency-Key"] = createIdempotencyKey();
    if (expectedRevision !== undefined) {
      headers["X-Liteasy-Expected-Revision"] = String(expectedRevision);
    }
    if (folderId) headers["X-Liteasy-Folder-Id"] = folderId;
    if (duplicateAction) headers["X-Liteasy-Duplicate-Action"] = duplicateAction;
    const response = await request(apiUrl(endpoint, "/v1/library/documents/upload"), {
      body: file,
      headers,
      method: "POST"
    });
    return jsonResponse<CloudLibraryUploadResult>(response);
  }

  async function uploadStreamOnce(input: {
    createBody: () => Promise<ReadableStream<Uint8Array>>;
    duplicateAction?: "cancel" | "save_copy";
    expectedRevision: number;
    fileName: string;
    folderId?: string;
    scope: CloudLibraryScope;
  }) {
    const sessionId = requireSessionId();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${sessionId}`,
      "Content-Type": "application/pdf",
      "X-Idempotency-Key": createIdempotencyKey(),
      "X-Liteasy-Expected-Revision": String(input.expectedRevision),
      "X-Liteasy-File-Name": encodeURIComponent(input.fileName),
      "X-Liteasy-Scope-Id": input.scope.scopeId,
      "X-Liteasy-Scope-Type": input.scope.scopeType,
      "X-Liteasy-Session-Id": sessionId
    };
    if (input.folderId) headers["X-Liteasy-Folder-Id"] = input.folderId;
    if (input.duplicateAction) {
      headers["X-Liteasy-Duplicate-Action"] = input.duplicateAction;
    }
    const requestInit = {
      body: await input.createBody(),
      duplex: "half",
      headers,
      method: "POST"
    } as RequestInit & { duplex: "half" };
    const response = await request(
      apiUrl(endpoint, "/v1/library/documents/upload"),
      requestInit
    );
    return jsonResponse<CloudLibraryUploadResult>(response);
  }

  return {
    downloadDocumentStream(
      scope: CloudLibraryScope,
      documentId: string,
      mode: "download" | "export" = "download"
    ) {
      return requestDocumentDownload(scope, documentId, mode);
    },
    async getOrganizationStoragePolicy(organizationId: string) {
      const sessionId = requireSessionId();
      const response = await request(apiUrl(endpoint, "/v1/org/storage-policy"), {
        body: JSON.stringify({ organizationId, sessionId }),
        headers: jsonHeaders(sessionId),
        method: "POST"
      });
      return jsonResponse<OrganizationStorageAccess & {
        revision: number;
        updatedAt: string;
        updatedBy: string;
      }>(response);
    },

    async updateOrganizationStoragePolicy(input: {
      expectedRevision: number;
      exportPolicy: OrganizationStorageAccess["exportPolicy"];
      organizationId: string;
      uploadPolicy: OrganizationStorageAccess["uploadPolicy"];
    }) {
      const sessionId = requireSessionId();
      const response = await request(apiUrl(endpoint, "/v1/org/storage-policy/update"), {
        body: JSON.stringify({
          ...input,
          idempotencyKey: createIdempotencyKey(),
          sessionId
        }),
        headers: jsonHeaders(sessionId),
        method: "POST"
      });
      return jsonResponse<OrganizationStorageAccess & {
        revision: number;
        updatedAt: string;
        updatedBy: string;
      }>(response);
    },

    async getTree(scope: CloudLibraryScope, status: "active" | "trashed" = "active") {
      return post<{ quota: CloudLibraryQuota; serverNow: string; tree: CloudLibraryTree }>(
        "/v1/library/tree",
        scope,
        { status }
      );
    },

    async createMetadataEntry(input: {
      doi?: string;
      externalUrl?: string;
      expectedRevision: number;
      folderId?: string;
      scope: CloudLibraryScope;
      sourceId?: string;
      title: string;
    }) {
      return post<{ entry: CloudLibraryMetadataEntry; revision: number }>(
        "/v1/library/entries/metadata",
        input.scope,
        { ...input, idempotencyKey: createIdempotencyKey() }
      );
    },

    async copyEntry(input: {
      documentId: string;
      expectedRevision: number;
      source: CloudLibraryScope;
      target: CloudLibraryScope & { folderId?: string };
    }) {
      const sessionId = requireSessionId();
      const response = await request(apiUrl(endpoint, "/v1/library/entries/copy"), {
        body: JSON.stringify({
          ...input,
          idempotencyKey: createIdempotencyKey(),
          sessionId
        }),
        headers: jsonHeaders(sessionId),
        method: "POST"
      });
      return jsonResponse<{ entry: CloudLibraryEntry; revision: number }>(response);
    },

    async uploadDocument(input: {
      file: File;
      expectedRevision: number;
      folderId?: string;
      onDuplicate?: (result: CloudLibraryUploadResult) => boolean | Promise<boolean>;
      scope: CloudLibraryScope;
    }) {
      const initial = await uploadOnce(
        input.scope,
        input.file,
        input.folderId,
        undefined,
        input.expectedRevision
      );
      if (initial.status !== "duplicate") return initial;
      const saveCopy = input.onDuplicate ? await input.onDuplicate(initial) : false;
      if (!saveCopy) {
        return uploadOnce(
          input.scope,
          input.file,
          input.folderId,
          "cancel",
          input.expectedRevision
        );
      }
      return uploadOnce(
        input.scope,
        input.file,
        input.folderId,
        "save_copy",
        input.expectedRevision
      );
    },

    async uploadDocumentStream(input: {
      createBody: () => Promise<ReadableStream<Uint8Array>>;
      expectedRevision: number;
      fileName: string;
      folderId?: string;
      onDuplicate?: (result: CloudLibraryUploadResult) => boolean | Promise<boolean>;
      scope: CloudLibraryScope;
    }) {
      const initial = await uploadStreamOnce(input);
      if (initial.status !== "duplicate") return initial;
      const saveCopy = input.onDuplicate ? await input.onDuplicate(initial) : false;
      return uploadStreamOnce({
        ...input,
        duplicateAction: saveCopy ? "save_copy" : "cancel"
      });
    },

    async listDocuments(scope: CloudLibraryScope, status: "active" | "all" | "trashed" = "active") {
      return post<{ documents: CloudLibraryDocument[]; quota: CloudLibraryQuota; serverNow: string }>(
        "/v1/library/documents/list",
        scope,
        { status }
      );
    },

    async trashDocument(scope: CloudLibraryScope, documentId: string, expectedRevision: number) {
      return post<{ document: CloudLibraryEntry }>(
        "/v1/library/documents/trash",
        scope,
        { documentId, expectedRevision, idempotencyKey: createIdempotencyKey() }
      );
    },

    async restoreDocument(scope: CloudLibraryScope, documentId: string, expectedRevision: number) {
      return post<{ document: CloudLibraryEntry }>(
        "/v1/library/documents/restore",
        scope,
        { documentId, expectedRevision, idempotencyKey: createIdempotencyKey() }
      );
    },

    async updateDocument(
      scope: CloudLibraryScope,
      documentId: string,
      changes: { expectedRevision: number; fileName?: string; folderId?: string | null; title?: string }
    ) {
      return post<{ document: CloudLibraryEntry; revision: number }>(
        "/v1/library/documents/update",
        scope,
        { documentId, idempotencyKey: createIdempotencyKey(), ...changes }
      );
    },

    async updateLiterature(
      scope: CloudLibraryScope,
      documentId: string,
      expectedRevision: number,
      literature: LiteratureRecord
    ) {
      return post<{ document: CloudLibraryEntry; revision: number }>(
        "/v1/library/documents/update",
        scope,
        { documentId, expectedRevision, idempotencyKey: createIdempotencyKey(), literature }
      );
    },

    async createFolder(
      scope: CloudLibraryScope,
      name: string,
      parentFolderId: string | undefined,
      expectedRevision: number
    ) {
      return post<{ folder: { folderId: string; name: string }; revision: number }>(
        "/v1/library/folders/create",
        scope,
        { expectedRevision, idempotencyKey: createIdempotencyKey(), name, parentFolderId }
      );
    },

    async updateFolder(
      scope: CloudLibraryScope,
      folderId: string,
      changes: { expectedRevision: number; name?: string; parentFolderId?: string | null }
    ) {
      return post<{ folder: { folderId: string; name: string } }>(
        "/v1/library/folders/update",
        scope,
        { folderId, idempotencyKey: createIdempotencyKey(), ...changes }
      );
    },

    async trashFolder(scope: CloudLibraryScope, folderId: string, expectedRevision: number) {
      return post<{ folder: CloudLibraryFolder; revision: number }>(
        "/v1/library/folders/trash",
        scope,
        { expectedRevision, folderId, idempotencyKey: createIdempotencyKey() }
      );
    },

    async restoreFolder(scope: CloudLibraryScope, folderId: string, expectedRevision: number) {
      return post<{ folder: CloudLibraryFolder }>(
        "/v1/library/folders/restore",
        scope,
        { expectedRevision, folderId, idempotencyKey: createIdempotencyKey() }
      );
    },

    async purgeEntry(scope: CloudLibraryScope, documentId: string, expectedRevision: number) {
      return post<{ result: { documentId: string; purged: boolean } }>(
        "/v1/library/entries/purge",
        scope,
        { documentId, expectedRevision, idempotencyKey: createIdempotencyKey() }
      );
    },

    async purgeFolder(scope: CloudLibraryScope, folderId: string, expectedRevision: number) {
      return post<{ folder: { folderId: string; purged: boolean }; revision: number }>(
        "/v1/library/folders/purge",
        scope,
        { expectedRevision, folderId, idempotencyKey: createIdempotencyKey() }
      );
    },

    async emptyTrash(scope: CloudLibraryScope, expectedRevision: number) {
      return post<{ purgedCount: number; revision: number }>(
        "/v1/library/trash/empty",
        scope,
        { expectedRevision, idempotencyKey: createIdempotencyKey() }
      );
    },

    async attachMetadataEntryPdf(input: {
      documentId: string;
      expectedRevision: number;
      file: File;
      scope: CloudLibraryScope;
    }) {
      const sessionId = requireSessionId();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${sessionId}`,
        "Content-Type": "application/pdf",
        "X-Idempotency-Key": createIdempotencyKey(),
        "X-Liteasy-Document-Id": input.documentId,
        "X-Liteasy-Expected-Revision": String(input.expectedRevision),
        "X-Liteasy-File-Name": encodeURIComponent(input.file.name),
        "X-Liteasy-Scope-Id": input.scope.scopeId,
        "X-Liteasy-Scope-Type": input.scope.scopeType,
        "X-Liteasy-Session-Id": sessionId
      };
      const response = await request(apiUrl(endpoint, "/v1/library/entries/attach-pdf"), {
        body: input.file,
        headers,
        method: "POST"
      });
      return jsonResponse<{ entry: CloudLibraryDocument; revision: number }>(response);
    },

    /** Every open begins with a live authorization request. A cached body is only read
     * after that succeeds; therefore organization documents are deliberately unavailable offline. */
    async openDocument(scope: CloudLibraryScope, documentId: string) {
      let authorization: {
        document: CloudLibraryDocument;
        expiresAt: string;
        revision: number;
        serverNow: string;
      };
      try {
        authorization = await post(
          "/v1/library/documents/authorize",
          scope,
          { documentId }
        );
      } catch (error) {
        throw authorizationError(error);
      }

      const cached = loadCacheRecord(scope, documentId);
      if (cached?.contentHash === authorization.document.contentHash) {
        try {
          const bytes = await readCachedPdf({ cachePath: cached.cachePath });
          saveCacheRecord(scope, documentId, {
            ...cached,
            expiresAt: authorization.expiresAt,
            lastAccessedAt: new Date().toISOString(),
            serverNow: authorization.serverNow
          });
          return { authorization, bytes, cachePath: cached.cachePath };
        } catch {
          // Missing or evicted local cache: fetch an authorized replacement below.
        }
      }

      const sessionId = requireSessionId();
      const response = await request(apiUrl(endpoint, "/v1/library/documents/download"), {
        body: JSON.stringify({ ...scope, documentId, sessionId }),
        headers: jsonHeaders(sessionId),
        method: "POST"
      });
      if (!response.ok) {
        throw await readCloudServiceError(response, {
          code: "library_download_failed",
          message: "文献下载失败，请稍后重试。"
        });
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const cachePath = await cacheExternalPdf({
        bytes,
        contentHash: authorization.document.contentHash
      });
      saveCacheRecord(scope, documentId, {
        cachePath,
        contentHash: authorization.document.contentHash,
        expiresAt: authorization.expiresAt,
        lastAccessedAt: new Date().toISOString(),
        serverNow: authorization.serverNow
      });
      return { authorization, bytes, cachePath };
    },

    async exportDocument(scope: CloudLibraryScope, documentId: string) {
      const sessionId = requireSessionId();
      const response = await request(apiUrl(endpoint, "/v1/library/documents/export"), {
        body: JSON.stringify({ ...scope, documentId, sessionId }),
        headers: jsonHeaders(sessionId),
        method: "POST"
      });
      if (!response.ok) {
        throw await readCloudServiceError(response, {
          code: "library_export_failed",
          message: "文献出库失败，请稍后重试。"
        });
      }
      return { bytes: new Uint8Array(await response.arrayBuffer()) };
    },

    async uploadTeamAnnotation(
      organizationId: string,
      documentId: string,
      annotation: Record<string, unknown>,
      expectedRevision: number
    ) {
      return post<{ annotation: { annotationId: string }; replayed: boolean; revision: number }>(
        "/v1/org/team-annotations/upload",
        { scopeId: organizationId, scopeType: "organization" },
        {
          annotation,
          documentId,
          expectedRevision,
          idempotencyKey: createIdempotencyKey(),
          organizationId
        }
      );
    },

    async listTeamAnnotations(organizationId: string, documentId: string) {
      return post<{ annotations: Array<{
        annotationId: string;
        body: Record<string, unknown>;
        createdAt: string;
        uploadedBy: string;
      }> }>(
        "/v1/org/team-annotations/list",
        { scopeId: organizationId, scopeType: "organization" },
        { documentId, organizationId }
      );
    },

    async withdrawTeamAnnotation(
      organizationId: string,
      annotationId: string,
      expectedRevision: number
    ) {
      return post<{ annotationId: string; replayed: boolean; revision: number; withdrawn: boolean }>(
        "/v1/org/team-annotations/withdraw",
        { scopeId: organizationId, scopeType: "organization" },
        {
          annotationId,
          expectedRevision,
          idempotencyKey: createIdempotencyKey(),
          organizationId
        }
      );
    }
  };
}
