import { normalizeUiKind } from "../assistant/contextAssetMetadata";
import type { ContextCatalogQuery } from "../assistant/contextCatalogQuery";

export type PickerPurpose = "context" | "reference";
export type PickerRoute = string[];
export type PickerLocation = {
  query: string; activeKind: string; projects: string[]; domain: "research" | "application";
  groupBy: ContextCatalogQuery["groupBy"]; sort: string; view: "list" | "gallery";
  filters?: { year?: string; readingStatus?: string; availability?: string; page?: string };
  page: number; anchor?: { id: string; offset: number }; focusId?: string; previewId?: string;
  previewPosition?: import("../resource-links/referencePdfSource").PreviewViewport & { resourceKey: string };
  openContent?: boolean; content?: { fragment?: string; page: number; limit: number; revision?: string };
};
export type BrowserLocationState = {
  schemaVersion: 3; route: PickerRoute; history: PickerRoute[]; historyIndex: number;
  locations: Record<string, PickerLocation>; entries: Record<string, PickerRoute>;
};
export const routeKey = (route: PickerRoute) => JSON.stringify(route);
export const defaultLocation = (): PickerLocation => ({ query: "", activeKind: "all", projects: [], domain: "research", groupBy: "none", sort: "default", view: "list", page: 0 });
export const browserStateKey = (scope: string, workspace: string, purpose: PickerPurpose, windowId = "main") =>
  `liteasy:context-picker:browse:${JSON.stringify([scope, workspace, purpose, windowId])}`;
export const draftStateKey = (scope: string, workspace: string, purpose: PickerPurpose, draft: string) =>
  `liteasy:context-picker:selection:${JSON.stringify([scope, workspace, purpose, draft])}`;
export function readPickerRecord<T>(key: string): T | undefined {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined; } catch { return undefined; }
}
export function writePickerRecord(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* UI memory remains usable without persistent storage. */ }
}
const routeValid = (value: unknown): value is PickerRoute => Array.isArray(value) && value.length > 0 && value.length < 12 && value.every(id => typeof id === "string" && id.length < 8192);
export function readBrowserState(key: string, scope: string, root = "collections"): BrowserLocationState {
  const raw = readPickerRecord<Omit<BrowserLocationState, "schemaVersion" | "locations"> & { schemaVersion: number; locations: Record<string, PickerLocation & { kinds?: string[] }> }>(key);
  if ((raw?.schemaVersion === 2 || raw?.schemaVersion === 3) && routeValid(raw.route) && Array.isArray(raw.history) && raw.history.length > 0 && raw.history.every(routeValid)
    && raw.locations && typeof raw.locations === "object" && raw.entries && typeof raw.entries === "object") {
    const locations: Record<string, PickerLocation> = {};
    for (const [id, value] of Object.entries(raw.locations).slice(-150)) {
      if (!value || typeof value.query !== "string" || !Array.isArray(value.projects) || !value.projects.every(id => typeof id === "string")) continue;
      const { kinds, ...location } = value;
      const activeKind = normalizeUiKind(raw.schemaVersion === 2 ? (Array.isArray(kinds) && kinds.length === 1 ? kinds[0] : "all") : typeof value.activeKind === "string" ? value.activeKind : "all");
      locations[id] = { ...defaultLocation(), ...location, activeKind, domain: value.domain === "application" ? "application" : "research", view: value.view === "gallery" ? "gallery" : "list", sort: typeof value.sort === "string" ? value.sort : "default",
        anchor: value.anchor && typeof value.anchor.id === "string" && Number.isFinite(value.anchor.offset) ? value.anchor : undefined,
        previewPosition: value.previewPosition && typeof value.previewPosition.resourceKey === "string" && Object.entries(value.previewPosition).every(([key, value]) => key === "resourceKey" || typeof value === "number" && Number.isFinite(value) && value >= 0) ? value.previewPosition : undefined,
        filters: value.filters && Object.values(value.filters).every(value => typeof value === "string") ? value.filters : undefined,
        content: value.content && Number.isSafeInteger(value.content.page) && value.content.page >= 0 && Number.isSafeInteger(value.content.limit) && value.content.limit > 0 && value.content.limit <= 80000 ? value.content : undefined, page: Number.isSafeInteger(value.page) && value.page >= 0 ? value.page : 0 };
    }
    return { ...raw, schemaVersion: 3, locations, entries: Object.fromEntries(Object.entries(raw.entries).filter(([, route]) => routeValid(route))), history: raw.history.slice(-60), historyIndex: Math.max(0, Math.min(raw.historyIndex || 0, Math.min(raw.history.length, 60) - 1)) };
  }
  const route = [root], location = defaultLocation();
  const legacy = readPickerRecord<{ query?: string; groupBy?: string; sort?: string }>(`liteasy:context-browser:${scope}`);
  if (legacy) {
    location.query = typeof legacy.query === "string" ? legacy.query : "";
    location.groupBy = legacy.groupBy === "project" || legacy.groupBy === "kind" ? legacy.groupBy : "none";
    location.sort = legacy.sort === "updated" ? "updated" : "title";
  }
  return { schemaVersion: 3, route, history: [route], historyIndex: 0, locations: { [routeKey(route)]: location }, entries: {} };
}
export function navigatePicker(state: BrowserLocationState, route: PickerRoute): BrowserLocationState {
  if (routeKey(state.route) === routeKey(route)) return state;
  const history = [...state.history.slice(0, state.historyIndex + 1), route].slice(-60);
  const current = state.locations[routeKey(state.route)] ?? defaultLocation();
  const locations = state.locations[routeKey(route)] ? state.locations : { ...state.locations, [routeKey(route)]: { ...defaultLocation(), activeKind: current.activeKind, domain: current.domain, query: current.query, projects: current.projects } };
  return { ...state, locations, route, history, historyIndex: history.length - 1, entries: { ...state.entries, [route[0]]: route } };
}
export function traversePickerHistory(state: BrowserLocationState, delta: number): BrowserLocationState {
  const index = Math.max(0, Math.min(state.history.length - 1, state.historyIndex + delta));
  return { ...state, historyIndex: index, route: state.history[index] };
}
