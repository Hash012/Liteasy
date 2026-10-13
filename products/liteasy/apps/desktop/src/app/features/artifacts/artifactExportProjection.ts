import type { ArtifactExportRecord } from "./artifactExport.types";

const supportedFormats = new Set(["html", "markdown", "pdf", "docx"]);
const originals = new WeakMap<ArtifactExportRecord, unknown>();

// Rust ArtifactExportRecord serializes required string fields, a format enum,
// desktop path and status. Check that contract again at the IPC boundary so a
// mismatched host/transport cannot make an unrelated saved view fail to render.
export function projectArtifactExportRecords(value: unknown): ArtifactExportRecord[] {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map((raw, index) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const row = raw as Record<string, unknown>;
      const validText = ["artifactId", "exportedAt", "fileName", "id", "title"].every((key) => typeof row[key] === "string");
      const validLocation = (row.location === "desktop" && typeof row.path === "string" && ["available", "missing", "unsupported"].includes(String(row.status))) ||
        (row.location === "browser" && row.path === undefined && ["browser_managed", "unsupported"].includes(String(row.status)));
      if (validText && validLocation && ((supportedFormats.has(String(row.format)) && row.status !== "unsupported") ||
        (row.format === "unknown" && row.status === "unsupported" && (row.originalFormat === undefined || typeof row.originalFormat === "string")))) {
        return raw as ArtifactExportRecord;
      }
      if (validText && validLocation && typeof row.format === "string" && !supportedFormats.has(row.format)) {
        const projected = { ...row, format: "unknown", originalFormat: row.format, status: "unsupported" } as ArtifactExportRecord;
        originals.set(projected, raw);
        return projected;
      }
    }
    const projected: ArtifactExportRecord = { artifactId: "", exportedAt: "", fileName: `不可读的导出记录（${index + 1}）`,
      format: "unknown", id: `unreadable-export-${index}`, location: "browser", status: "unsupported", title: "原始记录已保留" };
    originals.set(projected, raw);
    return projected;
  });
}
