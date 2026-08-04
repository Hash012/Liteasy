import { loadStoredAccountSession } from "../account/accountSessionStorage";
import { cacheExternalPdf, readCachedPdf } from "./paperCacheClient";
import { resolveLocalAccountKey } from "./localAccountKey";

export type CloudLibraryScope = {
  scopeId: string;
  scopeType: "organization" | "user";
};

export type CloudLibraryDocument = CloudLibraryScope & {
  byteLength: number;
  contentHash: string;
  createdAt: string;
  documentId: string;
  fileName: string;
  folderId?: string;
  purgeAfter?: string;
  status: "active" | "trashed";
  trashedAt?: string;
  updatedAt: string;
  uploadedBy: string;
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
  const payload = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `云端文献库请求失败（${response.status}）。`);
  }
  return payload;
}

export function createCloudLibraryStorageClient({
  endpoint,
  fetchImpl = fetch
}: CreateCloudLibraryStorageClientInput) {
  async function post<T>(path: string, scope: CloudLibraryScope, body: Record<string, unknown> = {}) {
    const response = await fetchImpl(apiUrl(endpoint, path), {
      body: JSON.stringify({ ...body, ...scope, sessionId: requireSessionId() }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    return jsonResponse<T>(response);
  }

  async function uploadOnce(
    scope: CloudLibraryScope,
    file: File,
    folderId?: string,
    duplicateAction?: "cancel" | "save_copy"
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "X-Liteasy-File-Name": encodeURIComponent(file.name),
      "X-Liteasy-Scope-Id": scope.scopeId,
      "X-Liteasy-Scope-Type": scope.scopeType,
      "X-Liteasy-Session-Id": requireSessionId()
    };
    if (folderId) headers["X-Liteasy-Folder-Id"] = folderId;
    if (duplicateAction) headers["X-Liteasy-Duplicate-Action"] = duplicateAction;
    const response = await fetchImpl(apiUrl(endpoint, "/v1/library/documents/upload"), {
      body: file,
      headers,
      method: "POST"
    });
    return jsonResponse<CloudLibraryUploadResult>(response);
  }

  return {
    async uploadDocument(input: {
      file: File;
      folderId?: string;
      onDuplicate?: (result: CloudLibraryUploadResult) => boolean | Promise<boolean>;
      scope: CloudLibraryScope;
    }) {
      const initial = await uploadOnce(input.scope, input.file, input.folderId);
      if (initial.status !== "duplicate") return initial;
      const saveCopy = input.onDuplicate ? await input.onDuplicate(initial) : false;
      if (!saveCopy) return uploadOnce(input.scope, input.file, input.folderId, "cancel");
      return uploadOnce(input.scope, input.file, input.folderId, "save_copy");
    },

    async listDocuments(scope: CloudLibraryScope, status: "active" | "all" | "trashed" = "active") {
      return post<{ documents: CloudLibraryDocument[]; quota: CloudLibraryQuota; serverNow: string }>(
        "/v1/library/documents/list",
        scope,
        { status }
      );
    },

    async trashDocument(scope: CloudLibraryScope, documentId: string) {
      return post<{ document: CloudLibraryDocument }>(
        "/v1/library/documents/trash",
        scope,
        { documentId }
      );
    },

    async restoreDocument(scope: CloudLibraryScope, documentId: string) {
      return post<{ document: CloudLibraryDocument }>(
        "/v1/library/documents/restore",
        scope,
        { documentId }
      );
    },

    async updateDocument(
      scope: CloudLibraryScope,
      documentId: string,
      changes: { fileName?: string; folderId?: string | null }
    ) {
      return post<{ document: CloudLibraryDocument }>(
        "/v1/library/documents/update",
        scope,
        { documentId, ...changes }
      );
    },

    async createFolder(
      scope: CloudLibraryScope,
      name: string,
      parentFolderId?: string
    ) {
      return post<{ folder: { folderId: string; name: string } }>(
        "/v1/library/folders/create",
        scope,
        { name, parentFolderId }
      );
    },

    async updateFolder(
      scope: CloudLibraryScope,
      folderId: string,
      changes: { name?: string; parentFolderId?: string | null }
    ) {
      return post<{ folder: { folderId: string; name: string } }>(
        "/v1/library/folders/update",
        scope,
        { folderId, ...changes }
      );
    },

    /** Every open begins with a live authorization request. A cached body is only read
     * after that succeeds; therefore organization documents are deliberately unavailable offline. */
    async openDocument(scope: CloudLibraryScope, documentId: string) {
      let authorization: {
        document: CloudLibraryDocument;
        expiresAt: string;
        serverNow: string;
      };
      try {
        authorization = await post(
          "/v1/library/documents/authorize",
          scope,
          { documentId }
        );
      } catch (error) {
        const reason = error instanceof Error ? ` ${error.message}` : "";
        throw new Error(`必须联网重新校验文献库权限，当前无法打开该文献。${reason}`);
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

      const response = await fetchImpl(apiUrl(endpoint, "/v1/library/documents/download"), {
        body: JSON.stringify({ ...scope, documentId, sessionId: requireSessionId() }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(`文献下载失败（${response.status}）。`);
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

    async uploadTeamAnnotation(
      organizationId: string,
      documentId: string,
      annotation: Record<string, unknown>
    ) {
      return post<{ annotation: { annotationId: string } }>(
        "/v1/org/team-annotations/upload",
        { scopeId: organizationId, scopeType: "organization" },
        { annotation, documentId, organizationId }
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

    async withdrawTeamAnnotation(organizationId: string, annotationId: string) {
      return post<{ annotationId: string; withdrawn: boolean }>(
        "/v1/org/team-annotations/withdraw",
        { scopeId: organizationId, scopeType: "organization" },
        { annotationId, organizationId }
      );
    }
  };
}
