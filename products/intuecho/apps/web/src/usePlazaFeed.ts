import { useEffect, useRef, useState } from "react";
import { communityApi } from "./communityApi";
import { CommunityRequestError } from "./communityCommands";
import { plazaFilterFields } from "./communityNavigation";
import type { CommunityAnnotation, PlazaFilters } from "./community.types";

const pageSize = 30;
const historyKey = "intuechoPlaza";
type FeedHistory = { actorKey: string; filters: PlazaFilters; pages: number; scrollY: number };
type FeedState = { key: string; annotations: CommunityAnnotation[]; nextCursor: string | null; pages: number; loading: boolean; error: string; loaded: boolean };
function filterKey(filters: PlazaFilters) {
  return JSON.stringify(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").sort(([a], [b]) => a.localeCompare(b)));
}
export function readPlazaHistory(actorKey: string): FeedHistory | null {
  const entry = window.history.state?.[historyKey];
  return entry?.actorKey === actorKey && entry.filters && typeof entry.filters === "object" && Number.isSafeInteger(entry.pages) && entry.pages > 0 && Number.isFinite(entry.scrollY)
    ? entry : null;
}
function initialState(key: string): FeedState {
  return { key, annotations: [], nextCursor: null, pages: 0, loading: true, error: "", loaded: false };
}
export function usePlazaFeed({ filters, actorKey, refresh }: { filters: PlazaFilters; actorKey: string; refresh: number }) {
  const [reload, setReload] = useState(0);
  const queryKey = filterKey(filters);
  const key = JSON.stringify([actorKey, queryKey, refresh, reload]);
  const paged = filters.sort === "latest" && ![filters.query, filters.institution, filters.educationStage, filters.documentType, filters.literatureIdentityKind, filters.literatureIdentityValue].some(Boolean);
  const [state, setState] = useState<FeedState>(() => initialState(key));
  const active = useRef<{ key: string; controller: AbortController; loading: boolean }>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentKey = useRef(key);
  currentKey.current = key;

  async function fetchPages(append: boolean, restore?: FeedHistory | null) {
    if (active.current?.key === key && active.current.loading) return;
    const controller = new AbortController();
    const request = { key, controller, loading: true };
    active.current = request;
    const previous = stateRef.current.key === key ? stateRef.current : initialState(key);
    let next = append ? { ...previous, loading: true, error: "" } : initialState(key);
    setState(next);
    const isCurrent = () => !controller.signal.aborted && currentKey.current === key && active.current === request;
    try {
      const wantedPages = append ? 1 : restore?.pages ?? 1;
      for (let index = 0; index < wantedPages; index += 1) {
        const cursor = next.nextCursor;
        const response = paged
          ? await communityApi.plazaPage({ limit: filters.limit ?? pageSize, ...(filters.literatureId ? { literatureId: filters.literatureId } : {}), ...(cursor ? { cursor } : {}) }, controller.signal)
          : await communityApi.plaza(filters, controller.signal);
        if (!isCurrent()) return;
        const nextCursor = "nextCursor" in response ? response.nextCursor : null;
        if (cursor && nextCursor === cursor) throw new Error("分页位置未前进，请刷新后重试。");
        const byId = new Map(next.annotations.map((item) => [item.id, item]));
        response.annotations.forEach((item) => byId.set(item.id, item));
        next = { ...next, annotations: [...byId.values()], nextCursor, pages: next.pages + 1, loaded: true };
        if (!nextCursor) break;
      }
      if (!isCurrent()) return;
      next.loading = false;
      stateRef.current = next;
      setState(next);
      if (restore) window.requestAnimationFrame(() => { if (isCurrent()) window.scrollTo(0, restore.scrollY); });
    } catch (error) {
      if (!isCurrent()) return;
      const denied = error instanceof CommunityRequestError && [401, 403, 404].includes(error.status);
      next = { ...(append && !denied ? previous : initialState(key)), loading: false, error: error instanceof Error ? error.message : "暂时无法加载，请重试。" };
      stateRef.current = next;
      setState(next);
    } finally { request.loading = false; }
  }

  useEffect(() => {
    const saved = readPlazaHistory(actorKey);
    const restore = saved && filterKey(saved.filters) === queryKey ? saved : null;
    void fetchPages(false, restore);
    return () => { active.current?.controller.abort(); active.current = undefined; };
  }, [key]);
  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden";
    const visibility = () => {
      if (wasHidden && document.visibilityState === "visible") setReload((value) => value + 1);
      wasHidden = document.visibilityState === "hidden";
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    const savePosition = () => {
      const current = stateRef.current;
      if (window.location.pathname !== "/" || current.key !== key || current.loading || !current.loaded) return;
      // History stores navigation metadata only. Back/refresh always re-authorizes pages.
      const url = new URL(window.location.href);
      plazaFilterFields.forEach((field) => url.searchParams.delete(field));
      Object.entries(filters).forEach(([field, value]) => { if (value !== undefined && value !== "") url.searchParams.set(field, String(value)); });
      window.history.replaceState({ ...window.history.state, [historyKey]: { actorKey, filters, pages: current.pages, scrollY: window.scrollY } satisfies FeedHistory }, "", `${url.pathname}${url.search}${url.hash}`);
    };
    savePosition();
    window.addEventListener("scroll", savePosition, { passive: true });
    return () => window.removeEventListener("scroll", savePosition);
  }, [key, state.pages, state.loading]);

  return {
    ...(state.key === key ? state : initialState(key)),
    legacyFilterNotice: filters.sort === "latest" && !paged ? "此筛选组合仍使用现有检索，暂不支持继续翻页；筛选条件已完整保留。" : "",
    paged,
    loadMore: () => fetchPages(Boolean(stateRef.current.nextCursor)),
    reload: () => setReload((value) => value + 1)
  };
}
