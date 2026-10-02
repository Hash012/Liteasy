import { isTauri } from "@tauri-apps/api/core";
import { version } from "../../../../package.json";
import type { DiagnosticRecord } from "./localDiagnostics";

export type DiagnosticEnvironment = {
  appVersion: string;
  runtime: "tauri" | "browser";
  os: "windows" | "macos" | "linux" | "ios" | "android" | "unknown";
  arch: "x86_64" | "x86" | "arm64" | "unknown";
  webviewEngine: "chromium" | "webkit" | "unknown";
  webviewEngineVersion: string;
};
const numericVersion = (value: string) => /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(value) ? value : "unknown";

/** Reduce observed browser metadata to enums/numeric versions; never retain the UA itself. */
export function diagnosticEnvironment(userAgent = navigator.userAgent, native = isTauri()): DiagnosticEnvironment {
  const chromium = /(?:Chrome|Chromium)\/([\d.]+)/.exec(userAgent)?.[1];
  const webkit = /AppleWebKit\/([\d.]+)/.exec(userAgent)?.[1];
  return {
    appVersion: numericVersion(version), runtime: native ? "tauri" : "browser",
    os: /Android/.test(userAgent) ? "android" : /iPhone|iPad/.test(userAgent) ? "ios"
      : /Windows/.test(userAgent) ? "windows" : /Macintosh/.test(userAgent) ? "macos"
      : /Linux/.test(userAgent) ? "linux" : "unknown",
    arch: /aarch64|arm64/i.test(userAgent) ? "arm64" : /x86_64|x64|Win64|WOW64/.test(userAgent) ? "x86_64"
      : /i[3-6]86|\bx86\b/.test(userAgent) ? "x86" : "unknown",
    webviewEngine: chromium ? "chromium" : webkit ? "webkit" : "unknown",
    webviewEngineVersion: numericVersion(chromium ?? webkit ?? ""),
  };
}

/** Explicit projection is the export boundary; never serialize collector or error objects. */
export function serializeDiagnosticPackage(records: readonly DiagnosticRecord[], droppedRecords: number, environment?: DiagnosticEnvironment): string {
  const errors = { choose_file: "choose_failed", read_file: "read_failed", open_reader: "reader_failed" } as const;
  const safeRecords = records.filter((record) => Object.prototype.hasOwnProperty.call(errors, record.stage)
    && ["succeeded", "cancelled", "failed"].includes(record.outcome)
    && Number.isSafeInteger(record.sequence) && record.sequence > 0).map((record) => ({
    sequence: record.sequence, stage: record.stage, outcome: record.outcome,
    durationMs: Number.isFinite(record.durationMs) ? Math.min(3_600_000, Math.max(0, Math.round(record.durationMs))) : 0,
    ...(record.format === "pdf" || record.format === "epub" ? { format: record.format } : {}),
    ...(record.outcome === "failed" ? { errorCode: errors[record.stage] } : {}),
  }));
  return JSON.stringify({
    schema: "liteasy.local-diagnostics/v1",
    ...(environment ? { environment: {
      appVersion: numericVersion(environment.appVersion),
      runtime: environment.runtime === "tauri" ? "tauri" : "browser",
      os: ["windows", "macos", "linux", "ios", "android"].includes(environment.os) ? environment.os : "unknown",
      arch: ["x86_64", "x86", "arm64"].includes(environment.arch) ? environment.arch : "unknown",
      webviewEngine: ["chromium", "webkit"].includes(environment.webviewEngine) ? environment.webviewEngine : "unknown",
      webviewEngineVersion: numericVersion(environment.webviewEngineVersion),
    } } : {}),
    droppedRecords: Number.isSafeInteger(droppedRecords) && droppedRecords > 0 ? droppedRecords : 0,
    records: safeRecords,
  }, null, 2);
}

export function downloadDiagnosticPackage(reviewedJson: string) {
  const revoke = URL.revokeObjectURL.bind(URL);
  const url = URL.createObjectURL(new Blob([reviewedJson], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "liteasy-local-diagnostics.json";
  document.body.append(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => revoke(url), 1000); }
}
