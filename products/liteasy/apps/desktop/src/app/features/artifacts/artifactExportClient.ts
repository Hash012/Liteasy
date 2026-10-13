import { projectArtifactExportRecords } from "./artifactExportProjection";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { downloadArtifactPayload } from "./artifactDocumentExport";
import type {
  ArtifactDocumentFormat,
  ArtifactExportOutcome,
  ArtifactExportPayload,
  ArtifactExportRecord
} from "./artifactExport.types";

const browserHistoryKey = "liteasy.artifact-export-history.browser.v2";
const legacyBrowserHistoryKey = "liteasy.artifact-export-history.browser.v1";
const browserHistoryVersion = "liteasy.artifact-export-history/v2";
const legacyBrowserHistoryVersion = "liteasy.artifact-export-history/v1";
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

const formats = new Set<ArtifactDocumentFormat>(["html", "markdown", "pdf", "docx"]);

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
  const serialized = storage.getItem(browserHistoryKey) ?? storage.getItem(legacyBrowserHistoryKey);
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || ![browserHistoryVersion, legacyBrowserHistoryVersion].includes(String(parsed.version)) ||
      !Array.isArray(parsed.records)) {
      return [];
    }
    return parsed.records.flatMap((raw: unknown) => {
      if (isBrowserRecord(raw)) return [raw];
      if (isRecord(raw) && typeof raw.format === "string" && !formats.has(raw.format as ArtifactDocumentFormat) && typeof raw.id === "string" && raw.location === "browser") return [{ artifactId: String(raw.artifactId ?? ""), exportedAt: String(raw.exportedAt ?? ""), fileName: String(raw.fileName ?? "未知格式记录"), format: "unknown" as const, originalFormat: raw.format, id: raw.id, title: String(raw.title ?? "未支持的历史格式"), location: "browser" as const, status: "unsupported" as const }];
      return [];
    })
      .slice(0, maxBrowserRecords)
      .sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
  } catch {
    return [];
  }
}

function saveBrowserHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  records: ArtifactExportRecord[]
) {
  let unknownRecords: unknown[] = [];
  try { const raw = JSON.parse(storage.getItem(browserHistoryKey) ?? storage.getItem(legacyBrowserHistoryKey) ?? "null"); if ([browserHistoryVersion, legacyBrowserHistoryVersion].includes(raw?.version) && Array.isArray(raw.records)) unknownRecords = raw.records.filter((record: unknown) => !isBrowserRecord(record)); } catch { /* corrupt input is not interpreted */ }
  const existing = storage.getItem(browserHistoryKey);
  if (existing) { const raw = JSON.parse(existing); if (raw?.version !== browserHistoryVersion) throw new Error("不支持的历史版本；保留原始记录。"); }
  const snapshot = {
    records: [...records.filter(isBrowserRecord).slice(0, maxBrowserRecords), ...unknownRecords],
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
      list: async () => projectArtifactExportRecords(await desktopInvoke("list_artifact_exports")),
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
        title: payload.title,
        ...(payload.receipt ? { receipt: payload.receipt } : {})
      };
      try {
        saveBrowserHistory(storage, [record, ...readBrowserHistory(storage)]);
      } catch (error) {
        return { record, status: "download_started", warnings: ["history_write_failed"] };
      }
      return { record, status: "download_started" };
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
