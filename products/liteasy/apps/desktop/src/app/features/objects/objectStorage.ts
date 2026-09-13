import { invoke, isTauri } from "@tauri-apps/api/core";
import { ObjectStoreError } from "./object.types";

export type StorageRow = { key: string; version: string; value: unknown };
export type StorageChange = {
  key: string;
  expected: string | null;
  row: StorageRow | null;
};
export interface ObjectStorage {
  get(key: string): Promise<StorageRow | null>;
  list(prefix: string, after?: string, limit?: number): Promise<StorageRow[]>;
  commit(changes: StorageChange[]): Promise<void>;
}
export function createObjectStorage(
  scope: string,
  currentScope: () => string,
): ObjectStorage {
  const check = () => {
    if (scope !== currentScope())
      throw new ObjectStoreError(
        "object_forbidden",
        "账号已切换，请重新打开。",
      );
  };
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    check();
    try {
      const result = await fn();
      check();
      return result;
    } catch (e) {
      if (e instanceof ObjectStoreError) throw e;
      const message = String(e);
      throw new ObjectStoreError(
        message.includes("revision_conflict")
          ? "revision_conflict"
          : message.includes("object_forbidden")
            ? "object_forbidden"
            : "persistence_failed",
        message.includes("revision_conflict")
          ? "内容已被修改，请刷新后重试。"
          : "保存或读取失败，请检查存储空间后重试。",
      );
    }
  };
  if (isTauri())
    return {
      get: (key) => wrap(() => invoke("object_store_get", { scope, key })),
      list: (prefix, after = "", limit = 100) =>
        wrap(() =>
          invoke("object_store_list", { scope, prefix, after, limit }),
        ),
      commit: (changes) =>
        wrap(() => invoke("object_store_commit", { scope, changes })),
    };
  let dbPromise: Promise<IDBDatabase> | undefined;
  const db = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open("liteasy.objects.v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("records");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Storage upgrade blocked"));
    }));
  const keyFor = (key: string) => JSON.stringify(scope) + ":" + key;
  return {
    get: (key) =>
      wrap(async () => {
        const database = await db();
        check();
        return new Promise((resolve, reject) => {
          const request = database
            .transaction("records")
            .objectStore("records")
            .get(keyFor(key));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        });
      }),
    list: (prefix, after = "", limit = 100) =>
      wrap(async () => {
        const database = await db();
        check();
        return new Promise((resolve, reject) => {
          const start = keyFor(after || prefix);
          const request = database
            .transaction("records")
            .objectStore("records")
            .getAll(
              IDBKeyRange.bound(
                start,
                keyFor(prefix) + "\uffff",
                !!after,
                false,
              ),
              Math.max(1, Math.min(limit, 1000)),
            );
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }),
    commit: (changes) =>
      wrap(async () => {
        if (
          changes.length > 1000 ||
          JSON.stringify(changes).length > 32 * 1024 * 1024
        )
          throw new Error("Transaction too large");
        const database = await db();
        check();
        return new Promise<void>((resolve, reject) => {
          const tx = database.transaction("records", "readwrite");
          const store = tx.objectStore("records");
          let failure: Error | undefined;
          const unique = new Set(changes.map((change) => change.key));
          if (unique.size !== changes.length) {
            tx.abort();
            reject(new Error("Duplicate transaction key"));
            return;
          }
          for (const change of changes) {
            const request = store.get(keyFor(change.key));
            request.onsuccess = () => {
              try {
                check();
                if ((request.result?.version ?? null) !== change.expected)
                  throw new ObjectStoreError(
                    "revision_conflict",
                    "内容已被修改，请刷新后重试。",
                  );
                if (change.key.startsWith("revision/") && request.result)
                  throw new ObjectStoreError(
                    "revision_conflict",
                    "历史版本不能覆盖。",
                  );
                if (
                  change.row?.key !== undefined &&
                  change.row.key !== change.key
                )
                  throw new Error("Invalid record key");
                if (change.row) store.put(change.row, keyFor(change.key));
                else store.delete(keyFor(change.key));
              } catch (e) {
                failure = e as Error;
                tx.abort();
              }
            };
          }
          tx.oncomplete = () => resolve();
          tx.onabort = () =>
            reject(failure ?? tx.error ?? new Error("Transaction aborted"));
          tx.onerror = () => reject(failure ?? tx.error);
        });
      }),
  };
}
