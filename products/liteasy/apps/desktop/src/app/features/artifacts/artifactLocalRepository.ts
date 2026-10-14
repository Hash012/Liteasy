import { researchDocumentSchema, researchDocumentMarkdown } from "../research-skills/researchDocument";
import { artifactMetadataIssueCount, projectArtifactMetadata } from "./artifactMetadataProjection";
import { invoke } from "@tauri-apps/api/core";
import type { ArtifactTab, ArtifactType } from "./artifact.types";
import { IntuitionGraphDocumentSchema } from "../intuition-graph/intuitionGraph.schema";
import { parseThinReadingDocument } from "../thin-reading/thinReadingVersioning";

const browserStorageKey = "liteasy.artifact-catalog.v1";
const databaseName = "liteasy-artifact-cache";
const objectStoreName = "snapshots";
const snapshotKey = "catalog-v1";

type ArtifactCatalogSnapshot = {
  artifacts: ArtifactTab[];
  savedAt: string;
  version: "liteasy.artifact-catalog/v1";
};

type ArtifactCatalogTransport = {
  load: () => Promise<unknown>;
  save: (snapshot: ArtifactCatalogSnapshot) => Promise<void>;
};

const artifactTypes = new Set<ArtifactType>([
  "research_document",
  "comparison_table",
  "layered_graph",
  "mindmap",
  "ppt",
  "skill_doc",
  "thin_reading",
  "tree"
]);

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCachedExternalSource(value: unknown): unknown {
  if (!isRecord(value) || typeof value.sourceRecordUrl === "string") {
    return value;
  }
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  if (value.provider !== "openalex" || !/^W\d+$/i.test(sourceId)) {
    return value;
  }
  return { ...value, sourceRecordUrl: `https://openalex.org/${sourceId}` };
}

function normalizeCachedThinReadingDocument(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.nodes)) {
    return value;
  }
  const nodes = Object.fromEntries(Object.entries(value.nodes).map(([nodeId, node]) => {
    if (!isRecord(node)) {
      return [nodeId, node];
    }
    return [nodeId, {
      ...node,
      ...(isRecord(node.evidence) && Array.isArray(node.evidence.externalSources)
        ? {
            evidence: {
              ...node.evidence,
              externalSources: node.evidence.externalSources.map(normalizeCachedExternalSource)
            }
          }
        : {}),
      recommendations: Array.isArray(node.recommendations)
        ? node.recommendations.filter((recommendation) => (
            isRecord(recommendation) && recommendation.source === "intuecho_community"
          ))
        : []
    }];
  }));
  return { ...value, nodes };
}

function isCachedThinReadingDocument(value: unknown, artifactId: string) {
  try {
    const parsed = parseThinReadingDocument(value);
    return parsed.artifactId === artifactId;
  } catch {
    return false;
  }
}

function isCachedArtifact(value: unknown): value is ArtifactTab {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ArtifactTab>;
  if (candidate.type === "research_document") {
    const parsed = researchDocumentSchema.safeParse(candidate.researchDocument);
    if (!parsed.success || candidate.answer !== researchDocumentMarkdown(parsed.data)) return false;
  }
  return (
    typeof candidate.artifactId === "string" &&
    candidate.artifactId.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.type === "string" &&
    artifactTypes.has(candidate.type as ArtifactType) &&
    candidate.type !== "skill_doc" &&
    (candidate.type !== "thin_reading" || isCachedThinReadingDocument(candidate.thinReadingDocument, candidate.artifactId)) &&
    (candidate.intuitionGraph === undefined || IntuitionGraphDocumentSchema.safeParse(candidate.intuitionGraph).success)
  );
}

export type ArtifactCatalogReadStatus = { issueCount: number; readOnly: boolean };

function normalizeSnapshot(value: unknown): { artifacts: ArtifactTab[]; status: ArtifactCatalogReadStatus } {
  if (value === null || value === undefined) return { artifacts: [], status: { issueCount: 0, readOnly: false } };
  if (!isRecord(value) || value.version !== "liteasy.artifact-catalog/v1" || !Array.isArray(value.artifacts)) {
    return { artifacts: [], status: { issueCount: 1, readOnly: true } };
  }
  let issueCount = 0;
  const artifacts = value.artifacts.flatMap((raw: unknown) => {
    const artifact = isRecord(raw) && raw.type === "thin_reading"
      ? { ...raw, thinReadingDocument: normalizeCachedThinReadingDocument(raw.thinReadingDocument) } : raw;
    if (!isCachedArtifact(artifact)) { issueCount += 1; return []; }
    const projected = projectArtifactMetadata(artifact);
    issueCount += artifactMetadataIssueCount(projected);
    return [projected];
  });
  return { artifacts, status: { issueCount, readOnly: issueCount > 0 } };
}

function createTauriTransport(): ArtifactCatalogTransport {
  return {
    load: () => invoke<unknown>("load_artifact_catalog_state"),
    save: (snapshot) => invoke<void>("save_artifact_catalog_state", {
      snapshot
    })
  };
}

function openDatabase(name = databaseName) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(objectStoreName)) {
        database.createObjectStore(objectStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地产物数据库"));
  });
}

function createIndexedDbTransport(): ArtifactCatalogTransport {
  async function readSnapshot(name = databaseName) {
    const database = await openDatabase(name);
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = database
          .transaction(objectStoreName, "readonly")
          .objectStore(objectStoreName)
          .get(snapshotKey);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error("无法读取本地产物数据库"));
      });
    } finally {
      database.close();
    }
  }

  async function writeSnapshot(snapshot: ArtifactCatalogSnapshot) {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(objectStoreName, "readwrite");
        transaction.objectStore(objectStoreName).put(snapshot, snapshotKey);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("无法保存本地产物数据库"));
        transaction.onabort = () => reject(transaction.error ?? new Error("本地产物数据库写入已中止"));
      });
    } finally {
      database.close();
    }
  }

  async function legacyDatabaseNames() {
    const listDatabases = window.indexedDB.databases?.bind(window.indexedDB);
    if (!listDatabases) {
      return [];
    }
    const databases = await listDatabases();
    return databases
      .map(({ name }) => name)
      .filter((name): name is string => Boolean(name?.startsWith(`${databaseName}-`)))
      .sort();
  }

  return {
    async load() {
      const current = await readSnapshot();
      if (current !== null) return current;
      const legacyNames = await legacyDatabaseNames();
      if (legacyNames.length > 0) {
        throw new Error("旧账号产物仍保留在原目录；请确认归属并备份后再显式导入，不会自动纳入本机资料。");
      }
      return null;
    },
    async save(snapshot) {
      await writeSnapshot(snapshot);
    }
  };
}

function createLocalStorageTransport(): ArtifactCatalogTransport {
  return {
    async load() {
      const serialized = window.localStorage.getItem(browserStorageKey);
      if (serialized === null) {
        const legacyScopedKeys = Array.from({ length: window.localStorage.length }, (_, index) =>
          window.localStorage.key(index)
        ).filter((key): key is string => Boolean(key?.startsWith(`${browserStorageKey}:`))).sort();
        if (legacyScopedKeys.length > 0) {
          throw new Error("旧账号产物仍保留在原目录；请确认归属并备份后再显式导入，不会自动纳入本机资料。");
        }
      }
      return serialized ? JSON.parse(serialized) : null;
    },
    async save(snapshot) {
      window.localStorage.setItem(browserStorageKey, JSON.stringify(snapshot));
    }
  };
}

function createDefaultTransport(): ArtifactCatalogTransport {
  if (isTauriRuntime()) {
    return createTauriTransport();
  }
  if (typeof window !== "undefined" && window.indexedDB) {
    return createIndexedDbTransport();
  }
  return createLocalStorageTransport();
}

export type ArtifactLocalRepository = {
  list: () => Promise<ArtifactTab[]>;
  replace: (artifacts: ArtifactTab[]) => Promise<void>;
  getReadStatus?: () => ArtifactCatalogReadStatus;
};

export function createArtifactLocalRepository(transport?: ArtifactCatalogTransport): ArtifactLocalRepository {
  const activeTransport = transport ?? createDefaultTransport();
  let readStatus: ArtifactCatalogReadStatus = { issueCount: 0, readOnly: false };
  // Keep the complete snapshot, including unknown records, until the next read.
  let sourceSnapshot: unknown;
  return {
    getReadStatus: () => ({ ...readStatus }),
    async list() {
      sourceSnapshot = await activeTransport.load();
      const projection = normalizeSnapshot(sourceSnapshot);
      readStatus = projection.status;
      return projection.artifacts.filter(artifact => artifact.type !== "research_document");
    },
    async replace(artifacts: ArtifactTab[]) {
      if (readStatus.readOnly || artifacts.some((artifact) => artifactMetadataIssueCount(artifact) > 0)) {
        throw new Error("目录中存在不可读记录，已保留原始资料；当前列表为只读，未覆盖保存。");
      }
      const persistentArtifacts = artifacts.filter((artifact) => artifact.type !== "skill_doc" && artifact.type !== "research_document");
      if (persistentArtifacts.some((artifact) => !isCachedArtifact(artifact) || artifactMetadataIssueCount(projectArtifactMetadata(artifact)) > 0)) {
        throw new Error("产物元数据无效，未覆盖已有目录。");
      }
      await activeTransport.save({ artifacts: persistentArtifacts, savedAt: new Date().toISOString(), version: "liteasy.artifact-catalog/v1" });
    }
  };
}
