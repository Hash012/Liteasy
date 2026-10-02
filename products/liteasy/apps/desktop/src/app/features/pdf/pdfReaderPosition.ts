import { createObjectStorage, type ObjectStorage, type StorageRow } from "../objects/objectStorage";

type PdfReaderPosition = {
  schemaVersion: 1;
  paperId: string;
  contentRevision: string;
  page: number;
  updatedAt: string;
};
const pending = new Map<string, Promise<unknown>>();
const recordKey = (paperId: string) => `reader-state/pdf/${paperId}`;

/** Prefer the original file's byte hash. PDF.js exposes both original and modified IDs. */
export function pdfReaderContentRevision(contentHash?: string, fingerprints?: readonly (string | null)[]): string | null {
  if (contentHash?.trim()) return `sha256:${contentHash.trim().toLowerCase()}`;
  return fingerprints?.[0] ? `pdf-id:${JSON.stringify(fingerprints)}` : null;
}

function read(row: StorageRow | null, paperId: string): PdfReaderPosition | null {
  if (!row) return null;
  const value = row.value as Partial<PdfReaderPosition> | null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
    row.key !== recordKey(paperId) || value.paperId !== paperId || typeof value.contentRevision !== "string" || !value.contentRevision ||
    !Number.isSafeInteger(value.page) || value.page! < 1 || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("阅读位置记录损坏或来自较新版本，原记录保持不变。");
  }
  return value as PdfReaderPosition;
}

/** Each write rereads and validates the row, then uses the store's optimistic transaction. */
export function createPdfReaderPositionStore(scope: string, currentScope: () => string | undefined,
  storage: ObjectStorage = createObjectStorage(scope, () => currentScope() ?? "")) {
  const check = () => { if (scope !== currentScope()) throw new Error("账号已切换，阅读位置未写入其他账号。"); };
  const queueKey = (paperId: string) => JSON.stringify([scope, recordKey(paperId)]);
  return {
    async load(paperId: string, contentRevision: string): Promise<number | null> {
      check();
      await pending.get(queueKey(paperId))?.catch(() => {});
      check();
      const value = read(await storage.get(recordKey(paperId)), paperId);
      check();
      return value?.contentRevision === contentRevision ? value.page : null;
    },
    save(paperId: string, contentRevision: string, page: number): Promise<void> {
      const queue = queueKey(paperId);
      const operation = (pending.get(queue) ?? Promise.resolve()).catch(() => {}).then(async () => {
        check();
        if (!paperId || !contentRevision || !Number.isSafeInteger(page) || page < 1) throw new Error("阅读位置无效。");
        const key = recordKey(paperId);
        const previous = await storage.get(key);
        check();
        read(previous, paperId); // Unknown versions and malformed rows remain read-only.
        const value: PdfReaderPosition = { schemaVersion: 1, paperId, contentRevision, page, updatedAt: new Date().toISOString() };
        await storage.commit([{ key, expected: previous?.version ?? null, row: { key, version: crypto.randomUUID(), value } }]);
        check();
      });
      pending.set(queue, operation);
      void operation.finally(() => { if (pending.get(queue) === operation) pending.delete(queue); }).catch(() => {});
      return operation;
    }
  };
}
