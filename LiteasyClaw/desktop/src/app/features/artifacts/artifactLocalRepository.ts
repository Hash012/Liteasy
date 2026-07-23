import { invoke } from "@tauri-apps/api/core";
import type { ArtifactTab, ArtifactType } from "./artifact.types";

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
  "comparison_table",
  "mindmap",
  "ppt",
  "skill_doc",
  "tree"
]);

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

function isCachedArtifact(value: unknown): value is ArtifactTab {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ArtifactTab>;
  return (
    typeof candidate.artifactId === "string" &&
    candidate.artifactId.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.type === "string" &&
    artifactTypes.has(candidate.type as ArtifactType) &&
    candidate.type !== "skill_doc"
  );
}

function normalizeSnapshot(value: unknown): ArtifactTab[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const snapshot = value as Partial<ArtifactCatalogSnapshot>;
  if (snapshot.version !== "liteasy.artifact-catalog/v1" || !Array.isArray(snapshot.artifacts)) {
    return [];
  }
  return snapshot.artifacts.filter(isCachedArtifact);
}

function createTauriTransport(): ArtifactCatalogTransport {
  return {
    load: () => invoke<unknown>("load_artifact_catalog_state"),
    save: (snapshot) => invoke<void>("save_artifact_catalog_state", { snapshot })
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
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
  return {
    async load() {
      const database = await openDatabase();
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
    },
    async save(snapshot) {
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
  };
}

function createLocalStorageTransport(): ArtifactCatalogTransport {
  return {
    async load() {
      const serialized = window.localStorage.getItem(browserStorageKey);
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

export function createArtifactLocalRepository(transport?: ArtifactCatalogTransport) {
  const activeTransport = transport ?? createDefaultTransport();
  return {
    async list() {
      return normalizeSnapshot(await activeTransport.load());
    },
    async replace(artifacts: ArtifactTab[]) {
      const persistentArtifacts = artifacts.filter(isCachedArtifact);
      await activeTransport.save({
        artifacts: persistentArtifacts,
        savedAt: new Date().toISOString(),
        version: "liteasy.artifact-catalog/v1"
      });
    }
  };
}

export type ArtifactLocalRepository = ReturnType<typeof createArtifactLocalRepository>;
