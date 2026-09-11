import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentArtifactResult } from "./artifact.types";
import type { ArtifactResultClient } from "./artifactResultClient";

const key = "liteasy.local-agent-artifacts.v1";
type Transport = {
  list(): Promise<AgentArtifactResult[]>;
  save(document: AgentArtifactResult): Promise<string>;
  delete(artifactId: string): Promise<void>;
};
function browserTransport(): Transport {
  async function access<T>(write: boolean, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(key, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("artifacts", { keyPath: "artifactId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction("artifacts", write ? "readwrite" : "readonly");
        const request = action(transaction.objectStore("artifacts"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("本地产物写入已中止。"));
      });
    } finally { database.close(); }
  }
  const list = async (): Promise<AgentArtifactResult[]> => typeof indexedDB === "undefined"
    ? JSON.parse(localStorage.getItem(key) ?? "[]") : access(false, (store) => store.getAll());
  return {
    list,
    async save(document) {
      if (typeof indexedDB === "undefined") localStorage.setItem(key, JSON.stringify([...(await list()).filter((item) => item.artifactId !== document.artifactId), document]));
      else await access(true, (store) => store.put(document));
      return `liteasy-local://agent-artifacts/${encodeURIComponent(document.artifactId)}.json`;
    },
    async delete(artifactId) {
      if (typeof indexedDB === "undefined") localStorage.setItem(key, JSON.stringify((await list()).filter((item) => item.artifactId !== artifactId)));
      else await access(true, (store) => store.delete(artifactId));
    }
  };
}
export function createLocalArtifactResultClient(transport?: Transport): ArtifactResultClient {
  const storage: Transport = transport ?? (isTauri() ? {
    list: () => invoke("list_local_agent_artifacts"),
    save: (document) => invoke("save_local_agent_artifact", { document }),
    delete: (artifactId) => invoke("delete_local_agent_artifact", { artifactId })
  } : browserTransport());
  return {
    list: storage.list,
    delete: storage.delete,
    async save(document, signal) {
      signal?.throwIfAborted();
      return storage.save(document);
    },
    async rename(artifactId, title) {
      const document = (await storage.list()).find((item) => item.artifactId === artifactId);
      if (!document) throw new Error("本地产物不存在。");
      const renamed = { ...document, title };
      await storage.save(renamed);
      return renamed;
    }
  };
}
