import { identity, normalizeItem } from "./references";
import type { ReferenceItem, SavedItem, StoredFile } from "./types";

const DB_NAME = "liteasy-connector-library";
let opened: Promise<IDBDatabase> | undefined;
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error || new Error("存储事务被中止。"));
  tx.onerror = () => { /* onabort is the final outcome */ };
});

async function database(): Promise<IDBDatabase> {
  return opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const items = req.result.createObjectStore("items", { keyPath: "id" });
      items.createIndex("identity", "identity", { unique: true });
      items.createIndex("updatedAt", "updatedAt");
      const files = req.result.createObjectStore("files", { keyPath: "id" });
      files.createIndex("itemId", "itemId");
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); opened = undefined; };
      resolve(req.result);
    };
    req.onerror = () => { opened = undefined; reject(req.error); };
  });
}

export async function saveReference(input: {
  item: ReferenceItem; sourceUrl: string; translator: string; collection: string;
  tags: string[]; warnings: string[];
  files: Omit<StoredFile, "itemId">[];
}): Promise<SavedItem> {
  const item = normalizeItem(input.item, input.sourceUrl);
  const key = identity(item);
  const db = await database();
  const tx = db.transaction(["items", "files"], "readwrite", { durability: "strict" });
  const done = complete(tx);
  // Attach immediately so a quota error cannot become an unhandled rejection.
  void done.catch(() => {});
  const store = tx.objectStore("items");
  const prior = await request(store.index("identity").get(key)) as SavedItem | undefined;
  const id = prior?.id || crypto.randomUUID();
  const attachments = [...(prior?.attachments || [])];
  for (const file of input.files) {
    const old = attachments.findIndex(a => a.url === file.url && a.mimeType === file.mimeType);
    if (old >= 0) tx.objectStore("files").delete(attachments.splice(old, 1)[0].id);
    const { blob, ...header } = file;
    attachments.push(header);
    tx.objectStore("files").put({ ...file, itemId: id });
  }
  const saved: SavedItem = {
    id, identity: key, item, sourceUrl: input.sourceUrl, translator: input.translator,
    collection: input.collection || prior?.collection || "未分类",
    tags: [...new Set([...(prior?.tags || []), ...input.tags])],
    createdAt: prior?.createdAt || Date.now(), updatedAt: Date.now(),
    attachments, warnings: input.warnings
  };
  store.put(saved);
  await done;
  return saved;
}

export async function listReferences(): Promise<SavedItem[]> {
  const tx = (await database()).transaction("items", "readonly");
  return (await request(tx.objectStore("items").getAll()) as SavedItem[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  return request((await database()).transaction("files").objectStore("files").get(id));
}

export async function editReference(id: string, changes: { collection: string; tags: string[] }): Promise<void> {
  const tx = (await database()).transaction("items", "readwrite", { durability: "strict" });
  const done = complete(tx); void done.catch(() => {});
  const item = await request(tx.objectStore("items").get(id)) as SavedItem | undefined;
  if (!item) throw new Error("这条文献已不存在。");
  tx.objectStore("items").put({ ...item, ...changes, updatedAt: Date.now() });
  await done;
}

export async function removeReference(id: string): Promise<void> {
  const tx = (await database()).transaction(["items", "files"], "readwrite", { durability: "strict" });
  const done = complete(tx); void done.catch(() => {});
  const keys = await request(tx.objectStore("files").index("itemId").getAllKeys(id));
  keys.forEach(key => tx.objectStore("files").delete(key));
  tx.objectStore("items").delete(id);
  await done;
}
