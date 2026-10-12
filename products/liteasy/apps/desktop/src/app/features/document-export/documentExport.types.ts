export type DocumentFormat = "pdf" | "markdown" | "docx" | "html";
export type ExportDiagnostic = { code: string; severity: "warning" | "error"; message: string; nodeId?: string; detailCode?: string };
export type ExportOptions = {
  scope: "full_saved" | "selected_nodes" | "current_subtree" | "excerpt";
  nodeIds?: readonly string[];
  evidenceMode: "references" | "excerpts" | "full_appendix";
  assetPolicy: "local_only";
  draftPolicy: "require_saved" | "frozen_draft";
  profileId: "research-report/v1" | "spatial-atlas/v1";
  acceptDegradations?: boolean;
  paperSize?: "A4" | "A3";
  orientation?: "portrait" | "landscape";
};
export const defaultExportOptions: ExportOptions = {
  scope: "full_saved", evidenceMode: "excerpts", assetPolicy: "local_only",
  draftPolicy: "require_saved", profileId: "research-report/v1",
};
/** Derived, task-local semantic tree. Raw HTML/CSS and executable nodes never enter it. */
export type DocumentNode = {
  id: string;
  type: "text" | "element" | "math";
  value?: string;
  tag?: string;
  properties?: Record<string, string | number | boolean | string[]>;
  children?: DocumentNode[];
  source?: { start: number; end: number };
};
export type ExportAsset = { id: string; sha256: string; mediaType: string; bytes: Uint8Array; path: string; origin?: "original" | "generated" };
export type ExportAttachment = { sha256: string; mediaType: "application/json" | "text/plain"; bytes: Uint8Array; path: string };
export type ExportSource = { identity: string; revision?: string; state: "pinned" | "legacy-unpinned" | "draft"; sha256: string };
export type ExportDocument = {
  version: "liteasy.export-document/v1";
  title: string;
  scopeId?: string;
  sessionGeneration?: string;
  assertAuthorized?: () => Promise<void>;
  protectedPaths?: string[];
  spatialAtlas?: import("./spatialAtlas").SpatialAtlas;
  nodes: DocumentNode[];
  assets: ExportAsset[];
  attachments?: ExportAttachment[];
  diagnostics: ExportDiagnostic[];
  sources: ExportSource[];
  sourceDigest: string;
  options: ExportOptions;
};
export type ExportReceipt = {
  version: "liteasy.export-receipt/v1";
  requestId: string;
  sourceDigest: string;
  profileId: ExportOptions["profileId"];
  sources: ExportSource[];
  diagnostics: ExportDiagnostic[];
  mimeType: string;
  byteLength: number;
  sha256: string;
  renderer: string;
  renderKey: string;
  fontManifest: string;
};
export const documentFormats: Record<DocumentFormat, { extension: string; mimeType: string }> = {
  pdf: { extension: "pdf", mimeType: "application/pdf" },
  markdown: { extension: "md", mimeType: "text/markdown;charset=utf-8" },
  html: { extension: "html", mimeType: "text/html;charset=utf-8" },
  docx: { extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};
export function safeDocumentStem(value: string) {
  let stem = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  stem = Array.from(stem).slice(0, 80).join("").replace(/[. ]+$/g, "");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `Liteasy-${stem}`;
  return stem || "Liteasy-文档";
}
export async function sha256(bytes: Uint8Array | string) {
  const buffer = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer.slice().buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).filter(([, entry]) => entry !== undefined).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function walkDocument(nodes: DocumentNode[], visit: (node: DocumentNode) => void) {
  for (const node of nodes) { visit(node); if (node.children) walkDocument(node.children, visit); }
}
