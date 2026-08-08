const browserStorageKey = "liteasy.paper-translations.v1";
const databaseName = "liteasy-paper-translations";
const objectStoreName = "snapshots";
const snapshotKey = "translations-v1";
const maximumTranslationCharacters = 1_500_000;
const maximumStoredCharacters = 4_000_000;
const maximumStoredTranslations = 40;

export type PersistedPaperTranslation = {
  content: string;
  id: string;
  paperId: string;
  sourceFingerprint: string;
  sourceLanguage: string;
  targetLanguage: string;
  updatedAt: string;
  version: "liteasy.paper-translation/v1";
};

type PaperTranslationSnapshot = {
  translations: PersistedPaperTranslation[];
  version: "liteasy.paper-translations/v1";
};

export type PaperTranslationTransport = {
  load: () => Promise<unknown>;
  save: (snapshot: PaperTranslationSnapshot) => Promise<void>;
};

type TranslationIdentity = {
  markedSource: string;
  paperId: string;
};

type SavePaperTranslationInput = TranslationIdentity & {
  content: string;
  sourceLanguage: string;
  targetLanguage: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Stable source identity prevents showing a stale translation after re-extraction. */
export function paperTranslationSourceFingerprint(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${value.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function translationId(input: SavePaperTranslationInput) {
  return JSON.stringify([
    input.paperId,
    paperTranslationSourceFingerprint(input.markedSource),
    input.sourceLanguage,
    input.targetLanguage
  ]);
}

function isPersistedPaperTranslation(value: unknown): value is PersistedPaperTranslation {
  if (!isRecord(value) || value.version !== "liteasy.paper-translation/v1") return false;
  return ["content", "id", "paperId", "sourceFingerprint", "sourceLanguage", "targetLanguage", "updatedAt"]
    .every((key) => typeof value[key] === "string") &&
    (value.content as string).length > 0 &&
    (value.content as string).length <= maximumTranslationCharacters &&
    !Number.isNaN(Date.parse(value.updatedAt as string));
}

function normalizeSnapshot(value: unknown) {
  if (!isRecord(value) || value.version !== "liteasy.paper-translations/v1" || !Array.isArray(value.translations)) {
    return [];
  }
  return value.translations
    .filter(isPersistedPaperTranslation)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function boundedTranslations(translations: PersistedPaperTranslation[]) {
  const bounded: PersistedPaperTranslation[] = [];
  let characters = 0;
  for (const translation of translations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (bounded.length >= maximumStoredTranslations) break;
    if (characters + translation.content.length > maximumStoredCharacters) continue;
    bounded.push(translation);
    characters += translation.content.length;
  }
  return bounded;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) {
        request.result.createObjectStore(objectStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开论文翻译数据库。"));
  });
}

function createIndexedDbTransport(): PaperTranslationTransport {
  return {
    async load() {
      const database = await openDatabase();
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const request = database.transaction(objectStoreName, "readonly").objectStore(objectStoreName).get(snapshotKey);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error ?? new Error("无法读取论文翻译数据库。"));
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
          transaction.onerror = () => reject(transaction.error ?? new Error("无法保存论文翻译。"));
          transaction.onabort = () => reject(transaction.error ?? new Error("论文翻译写入已中止。"));
        });
      } finally {
        database.close();
      }
    }
  };
}

function createLocalStorageTransport(): PaperTranslationTransport {
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

function createDefaultTransport() {
  if (typeof window !== "undefined" && window.indexedDB) return createIndexedDbTransport();
  return createLocalStorageTransport();
}

export function createPaperTranslationRepository(transport?: PaperTranslationTransport) {
  const activeTransport = transport ?? createDefaultTransport();
  let mutationQueue = Promise.resolve();
  return {
    async list(input: TranslationIdentity) {
      const fingerprint = paperTranslationSourceFingerprint(input.markedSource);
      return normalizeSnapshot(await activeTransport.load()).filter((translation) => (
        translation.paperId === input.paperId && translation.sourceFingerprint === fingerprint
      ));
    },
    async save(input: SavePaperTranslationInput) {
      if (!input.content.trim() || input.content.length > maximumTranslationCharacters) {
        throw new Error("论文译文为空或超出本地保存上限。");
      }
      let saved: PersistedPaperTranslation | undefined;
      mutationQueue = mutationQueue.catch(() => undefined).then(async () => {
        const current = normalizeSnapshot(await activeTransport.load());
        saved = {
          content: input.content.trim(),
          id: translationId(input),
          paperId: input.paperId,
          sourceFingerprint: paperTranslationSourceFingerprint(input.markedSource),
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          updatedAt: new Date().toISOString(),
          version: "liteasy.paper-translation/v1"
        };
        const translations = boundedTranslations([saved, ...current.filter((item) => item.id !== saved!.id)]);
        await activeTransport.save({ translations, version: "liteasy.paper-translations/v1" });
      });
      await mutationQueue;
      return saved!;
    }
  };
}

export type PaperTranslationRepository = ReturnType<typeof createPaperTranslationRepository>;
