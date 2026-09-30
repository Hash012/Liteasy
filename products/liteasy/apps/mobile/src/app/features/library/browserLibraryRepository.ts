import { type ImportResource, type LibraryItem, type LibraryRepository, resourceKind, validateImport } from "./library.types";

const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error ?? new Error("无法访问资料存储。"));
});

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("保存失败，请检查剩余空间。"));
  });
}

export class BrowserLibraryRepository implements LibraryRepository {
  private database: Promise<IDBDatabase>;
  constructor(name = "liteasy-mobile-v1") {
    this.database = new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("items");
        open.result.createObjectStore("blobs");
        open.result.createObjectStore("records");
        open.result.createObjectStore("hashes");
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("请关闭其他 Liteasy 页面后重试。"));
      open.onsuccess = () => {
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
    });
  }

  async list(scope: string) {
    const db = await this.database;
    return request<LibraryItem[]>(db.transaction("items").objectStore("items").getAll(IDBKeyRange.bound([scope, ""], [scope, "\uffff"])));
  }

  async importResource(scope: string, input: ImportResource) {
    validateImport(input);
    const bytes = input.bytes ?? new TextEncoder().encode(input.sourceUrl ?? input.text ?? "");
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const now = new Date().toISOString();
    const item: LibraryItem = {
      id: crypto.randomUUID(), kind: resourceKind(input.mimeType ?? "", input.filename ?? "", input.text, input.sourceUrl),
      title: input.title.trim(), filename: input.filename ?? "", mimeType: input.mimeType ?? "text/plain", size: bytes.byteLength,
      contentHash, sourceUrl: input.sourceUrl, text: input.text, collection: input.collection ?? "收件箱", tags: [], note: input.note ?? "",
      createdAt: now, updatedAt: now, page: 1, pinned: false, downloaded: true, revision: 1
    };
    const db = await this.database;
    const transaction = db.transaction(["items", "blobs", "hashes"], "readwrite");
    const done = transactionDone(transaction);
    // Register rejection before awaiting requests, including a quota failure during put.
    void done.catch(() => {});
    const hashKey = [scope, item.kind, contentHash];
    const existingId = await request<string | undefined>(transaction.objectStore("hashes").get(hashKey));
    if (existingId) {
      const existing = await request<LibraryItem>(transaction.objectStore("items").get([scope, existingId]));
      if (existing.deletedAt) {
        delete existing.deletedAt;
        existing.updatedAt = now;
        existing.revision += 1;
        transaction.objectStore("items").put(existing, [scope, existing.id]);
      }
      await done;
      return existing;
    }
    transaction.objectStore("items").put(item, [scope, item.id]);
    transaction.objectStore("hashes").put(item.id, hashKey);
    transaction.objectStore("blobs").put(new Uint8Array(bytes), [scope, item.id]);
    await done;
    return item;
  }

  async update(scope: string, item: LibraryItem) {
    const db = await this.database;
    const transaction = db.transaction("items", "readwrite");
    const done = transactionDone(transaction);
    void done.catch(() => {});
    const store = transaction.objectStore("items");
    const current = await request<LibraryItem | undefined>(store.get([scope, item.id]));
    if (!current || current.revision !== item.revision) {
      transaction.abort();
      await done.catch(() => {});
      throw new Error("资料已在其他窗口更新，请刷新后重试。");
    }
    const next = { ...item, revision: item.revision + 1, updatedAt: new Date().toISOString() };
    store.put(next, [scope, item.id]);
    await done;
    return next;
  }

  async readBytes(scope: string, id: string, expectedHash?: string) {
    const db = await this.database;
    const tx = db.transaction(["blobs", "items"]);
    const [bytes, item] = await Promise.all([
      request<Uint8Array | undefined>(tx.objectStore("blobs").get([scope, id])),
      request<LibraryItem | undefined>(tx.objectStore("items").get([scope, id]))
    ]);
    if (!bytes) throw new Error("此文件尚未下载到本机。");
    if (expectedHash && expectedHash !== item?.contentHash) throw new Error("资料版本已更新，请返回资料库刷新后再打开。");
    return new Uint8Array(bytes);
  }

  async readRecord<T>(scope: string, key: string): Promise<T | undefined> {
    const db = await this.database;
    return request(db.transaction("records").objectStore("records").get([scope, key]));
  }

  async writeRecord<T>(scope: string, key: string, value: T) {
    const db = await this.database;
    const transaction = db.transaction("records", "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("records").put(value, [scope, key]);
    await done;
  }
}
