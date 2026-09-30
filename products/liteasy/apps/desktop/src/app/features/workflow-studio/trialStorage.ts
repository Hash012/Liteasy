import type { ObjectStorage, StorageRow } from "../objects/objectStorage";
/** Real persistence under the active account, with isolated logical identities for fixture copies.
 * Do not pass a synthetic dev account to native IPC: native scope authorization must remain intact.
 */
export function createTrialStorage(parent: ObjectStorage, id: string): ObjectStorage {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error("试跑标识无效。");
  const prefix = `extension-trial-data/${id}/`;
  const unwrap = (row: StorageRow): StorageRow => ({ ...row, key: row.key.slice(prefix.length) });
  const path = (key: string) => { if (!key || key.length > 1900) throw new Error("试跑记录路径无效。"); return prefix + key; };
  return {
    async get(key) { const row = await parent.get(path(key)); return row ? unwrap(row) : null; },
    async list(start, after = "", limit = 100) { return (await parent.list(prefix + start, after ? path(after) : "", limit)).map(unwrap); },
    async commit(changes) { return parent.commit(changes.map((item) => ({ ...item, key: path(item.key), row: item.row ? { ...item.row, key: path(item.row.key) } : null }))); },
  };
}
export async function clearTrialStorage(storage: ObjectStorage) {
  let rows;
  do { rows = await storage.list("", "", 200); if (rows.length) await storage.commit(rows.map((row) => ({ key: row.key, expected: row.version, row: null }))); } while (rows.length);
}
