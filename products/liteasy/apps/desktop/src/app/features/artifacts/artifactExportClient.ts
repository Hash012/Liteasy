import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { downloadArtifactPayload } from "./artifactDocumentExport";
import type {
  ArtifactDocumentFormat,
  ArtifactExportOutcome,
  ArtifactExportPayload,
  ArtifactExportRecord
} from "./artifactExport.types";

const browserHistoryKey = "liteasy.artifact-export-history.browser.v1";
const browserHistoryVersion = "liteasy.artifact-export-history/v1";
const maxBrowserRecords = 200;

type ArtifactExportInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

type ArtifactExportClientInput = {
  createId?: () => string;
  download?: (payload: ArtifactExportPayload) => void;
  invoke?: ArtifactExportInvoke;
  now?: () => Date;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

export type ArtifactExportClient = {
  export: (payload: ArtifactExportPayload) => Promise<ArtifactExportOutcome>;
  list: () => Promise<ArtifactExportRecord[]>;
  open: (recordId: string) => Promise<ArtifactExportRecord>;
  remove: (recordId: string) => Promise<void>;
  reveal: (recordId: string) => Promise<ArtifactExportRecord>;
};

type BrowserHistorySnapshot = {
  records: ArtifactExportRecord[];
  version: typeof browserHistoryVersion;
};

const formats = new Set<ArtifactDocumentFormat>(["html", "markdown", "pdf"]);

function isTauriRuntime() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBrowserRecord(value: unknown): value is ArtifactExportRecord {
  if (!isRecord(value)) return false;
  return typeof value.artifactId === "string" &&
    typeof value.exportedAt === "string" &&
    typeof value.fileName === "string" &&
    formats.has(value.format as ArtifactDocumentFormat) &&
    typeof value.id === "string" &&
    value.location === "browser" &&
    value.path === undefined &&
    value.status === "browser_managed" &&
    typeof value.title === "string";
}

function readBrowserHistory(storage: Pick<Storage, "getItem">): ArtifactExportRecord[] {
  const serialized = storage.getItem(browserHistoryKey);
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== browserHistoryVersion ||
      !Array.isArray(parsed.records) || !parsed.records.every(isBrowserRecord)) {
      return [];
    }
    return parsed.records
      .slice(0, maxBrowserRecords)
      .sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
  } catch {
    return [];
  }
}

function saveBrowserHistory(
  storage: Pick<Storage, "setItem">,
  records: ArtifactExportRecord[]
) {
  const snapshot: BrowserHistorySnapshot = {
    records: records.slice(0, maxBrowserRecords),
    version: browserHistoryVersion
  };
  storage.setItem(browserHistoryKey, JSON.stringify(snapshot));
}

function defaultId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `browser-${crypto.randomUUID()}`;
  }
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createArtifactExportClient({
  createId = defaultId,
  download = downloadArtifactPayload,
  invoke,
  now = () => new Date(),
  storage = window.localStorage
}: ArtifactExportClientInput = {}): ArtifactExportClient {
  const desktopInvoke = invoke ?? (isTauriRuntime() ? tauriInvoke as ArtifactExportInvoke : undefined);

  if (desktopInvoke) {
    return {
      export: async (payload) => (
        desktopInvoke("export_artifact_document", { input: payload }) as Promise<ArtifactExportOutcome>
      ),
      list: async () => (
        desktopInvoke("list_artifact_exports") as Promise<ArtifactExportRecord[]>
      ),
      open: async (recordId) => (
        desktopInvoke("open_artifact_export", { recordId }) as Promise<ArtifactExportRecord>
      ),
      remove: async (recordId) => {
        await desktopInvoke("remove_artifact_export", { recordId });
      },
      reveal: async (recordId) => (
        desktopInvoke("reveal_artifact_export", { recordId }) as Promise<ArtifactExportRecord>
      )
    };
  }

  return {
    export: async (payload) => {
      download(payload);
      const record: ArtifactExportRecord = {
        artifactId: payload.artifactId,
        exportedAt: now().toISOString(),
        fileName: payload.fileName,
        format: payload.format,
        id: createId(),
        location: "browser",
        status: "browser_managed",
        title: payload.title
      };
      try {
        saveBrowserHistory(storage, [record, ...readBrowserHistory(storage)]);
      } catch (error) {
        throw new Error(
          `文件已下载，但未写入导出历史：${error instanceof Error ? error.message : String(error)}`
        );
      }
      return { record, status: "saved" };
    },
    list: async () => readBrowserHistory(storage),
    open: async () => {
      throw new Error("该导出由浏览器管理，无法从 Liteasy 直接打开。");
    },
    remove: async (recordId) => {
      saveBrowserHistory(
        storage,
        readBrowserHistory(storage).filter((record) => record.id !== recordId)
      );
    },
    reveal: async () => {
      throw new Error("该导出由浏览器管理，无法从 Liteasy 定位文件。");
    }
  };
}
