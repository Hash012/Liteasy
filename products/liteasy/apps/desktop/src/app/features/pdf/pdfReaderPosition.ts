import { createObjectStorage, type ObjectStorage, type StorageRow } from "../objects/objectStorage";

export type PdfReaderViewState = {
  zoom: number;
  layoutMode: "continuous" | "single" | "spread";
};

type PdfReaderPosition = {
  schemaVersion: 1;
  paperId: string;
  contentRevision: string;
  page: number;
  topRatio?: number;
  /** Distance above the selected page when its top is still below the viewport edge. */
  topGapRatio?: number;
  pageCount?: number;
  view?: PdfReaderViewState;
  updatedAt: string;
};
const pending = new Map<string, Promise<unknown>>();
const recordKey = (paperId: string) => `reader-state/pdf/${paperId}`;
class ReadOnlyPositionError extends Error {}
export function isPdfPositionReadOnlyError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return error instanceof ReadOnlyPositionError || code === "revision_conflict" || code === "object_forbidden" ||
    error instanceof Error && /revision_conflict|object_forbidden/.test(error.message);
}

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
    throw new ReadOnlyPositionError("阅读位置记录损坏或来自较新版本，原记录保持不变。");
  }
  if (value.topRatio !== undefined && (!Number.isFinite(value.topRatio) || value.topRatio < 0 || value.topRatio > 1)) {
    throw new ReadOnlyPositionError("阅读位置的页内偏移无效，原记录保持不变。");
  }
  if (value.topGapRatio !== undefined && (!Number.isFinite(value.topGapRatio) || value.topGapRatio <= 0 || value.topRatio !== 0)) {
    throw new ReadOnlyPositionError("阅读位置的跨页偏移无效，原记录保持不变。");
  }
  validateDetails(value.page!, value.pageCount, value.view);
  return value as PdfReaderPosition;
}

function validateDetails(page: number, pageCount?: number, view?: PdfReaderViewState) {
  if (pageCount !== undefined && (!Number.isSafeInteger(pageCount) || pageCount < page)) {
    throw new ReadOnlyPositionError("阅读进度的总页数无效，原记录保持不变。");
  }
  if (view !== undefined && (!view || typeof view !== "object" || Array.isArray(view) ||
    !Number.isFinite(view.zoom) || view.zoom < 70 || view.zoom > 180 ||
    !["continuous", "single", "spread"].includes(view.layoutMode))) {
    throw new ReadOnlyPositionError("阅读视图记录无效，原记录保持不变。");
  }
}

/** Each write rereads and validates the row, then uses the store's optimistic transaction. */
export function createPdfReaderPositionStore(scope: string, currentScope: () => string | undefined,
  storage: ObjectStorage = createObjectStorage(scope, () => currentScope() ?? "")) {
  const check = () => { if (scope !== currentScope()) throw new ReadOnlyPositionError("账号已切换，阅读位置未写入其他账号。"); };
  const queueKey = (paperId: string) => JSON.stringify([scope, recordKey(paperId)]);
  const loadLocation = async (paperId: string, contentRevision: string) => {
    check();
    await pending.get(queueKey(paperId))?.catch(() => {});
    check();
    const value = read(await storage.get(recordKey(paperId)), paperId);
    check();
    return value?.contentRevision === contentRevision ? {
      page: value.page, topRatio: value.topGapRatio === undefined ? value.topRatio : -value.topGapRatio,
      ...(value.view ? { view: value.view } : {}),
      ...(value.pageCount === undefined ? {} : { pageCount: value.pageCount })
    } : null;
  };
  return {
    loadLocation,
    async load(paperId: string, contentRevision: string): Promise<number | null> {
      return (await loadLocation(paperId, contentRevision))?.page ?? null;
    },
    save(paperId: string, contentRevision: string, page: number, topRatio?: number,
      details: { pageCount?: number; view?: PdfReaderViewState } = {}): Promise<void> {
      const queue = queueKey(paperId);
      const operation = (pending.get(queue) ?? Promise.resolve()).catch(() => {}).then(async () => {
        check();
        if (!paperId || !contentRevision || !Number.isSafeInteger(page) || page < 1) throw new ReadOnlyPositionError("阅读位置无效。");
        if (topRatio !== undefined && (!Number.isFinite(topRatio) || topRatio > 1)) throw new ReadOnlyPositionError("阅读位置的页内偏移无效。");
        validateDetails(page, details.pageCount, details.view);
        const key = recordKey(paperId);
        const previous = await storage.get(key);
        check();
        read(previous, paperId); // Unknown versions and malformed rows remain read-only.
        const value: PdfReaderPosition = { schemaVersion: 1, paperId, contentRevision, page,
          ...(topRatio === undefined ? {} : { topRatio: Math.max(0, topRatio) }),
          ...(topRatio !== undefined && topRatio < 0 ? { topGapRatio: -topRatio } : {}),
          ...(details.pageCount === undefined ? {} : { pageCount: details.pageCount }),
          ...(details.view ? { view: details.view } : {}), updatedAt: new Date().toISOString() };
        await storage.commit([{ key, expected: previous?.version ?? null, row: { key, version: crypto.randomUUID(), value } }]);
        check();
      });
      pending.set(queue, operation);
      void operation.finally(() => { if (pending.get(queue) === operation) pending.delete(queue); }).catch(() => {});
      return operation;
    }
  };
}
