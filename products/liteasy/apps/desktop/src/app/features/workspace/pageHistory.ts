import type { DockItemId } from "../dock/dock.types";
import type { WorkspaceSurface } from "./workspaceShell.types";

export type WorkspacePageTarget =
  | { kind: "dock"; itemId: DockItemId }
  | { kind: "paper"; id: string }
  | { kind: "paper-resource"; paperId: string; resourceKind: "extracted_text" | "figures" | "multimodal" }
  | { kind: "resource"; path: string }
  | { kind: "reading"; id: string }
  | { kind: "recommendation"; id: string }
  | { kind: "note-selection"; key: string };
export type WorkspacePageVisit = {
  key: string; surfaceId: string; title: string; region: string; type: string;
  visitedAt: number; target?: WorkspacePageTarget;
};
export type WorkspacePageOption = WorkspacePageVisit & { open: boolean; available: boolean };
export const pageKey = (surface: WorkspaceSurface) => surface.pageKey ?? surface.id;
export function pageVisit(surface: WorkspaceSurface, visitedAt: number): WorkspacePageVisit {
  // Keep locators and labels only: history must never retain PDF buffers, previews or render callbacks.
  return { key: pageKey(surface), surfaceId: surface.id, title: surface.title, region: surface.region,
    type: surface.pageType ?? surface.fileStatus?.type ?? (surface.dynamic ? "产物" : "工作区"), visitedAt, target: surface.pageTarget };
}
export function recordPageVisit(visits: WorkspacePageVisit[], surface: WorkspaceSurface, time = Date.now()) {
  return [pageVisit(surface, time), ...visits.filter((entry) => entry.key !== pageKey(surface))].slice(0, 100);
}
export function pageOptions(surfaces: WorkspaceSurface[], visits: WorkspacePageVisit[], mode: "history" | "active"): WorkspacePageOption[] {
  const current = new Map(surfaces.map((surface) => [pageKey(surface), surface]));
  if (mode === "active") return [...current.values()].map((surface) => ({
    ...pageVisit(surface, visits.find((entry) => entry.key === pageKey(surface))?.visitedAt ?? 0), open: true, available: true
  }));
  return visits.map((visit) => {
    const surface = current.get(visit.key);
    return { ...(surface ? pageVisit(surface, visit.visitedAt) : visit), open: Boolean(surface), available: Boolean(surface || visit.target) };
  });
}
export function movePageSelection(index: number, key: string, count: number, columns: number) {
  if (!count) return 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "ArrowDown") return Math.min(count - 1, index + Math.max(1, columns));
  if (key === "ArrowUp") return Math.max(0, index - Math.max(1, columns));
  return index;
}
