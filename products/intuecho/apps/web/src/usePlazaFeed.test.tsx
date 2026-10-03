import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { communityApi } from "./communityApi";
import { CommunityRequestError } from "./communityCommands";
import type { CommunityAnnotation, PlazaFilters } from "./community.types";
import { usePlazaFeed } from "./usePlazaFeed";
vi.mock("./communityApi", () => ({ communityApi: { plaza: vi.fn(), plazaPage: vi.fn() } }));
const annotations = Array.from({ length: 65 }, (_, index) => ({ id: `authorized-${index + 1}`, body: `Authorized synthetic ${index + 1}` }) as CommunityAnnotation);
beforeEach(() => { vi.clearAllMocks(); history.replaceState({}, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("reads all 65 authorized items across three latest pages, deduplicates overlap, and retries the same cursor", async () => {
  vi.mocked(communityApi.plazaPage)
    .mockResolvedValueOnce({ annotations: annotations.slice(0, 30), nextCursor: "page-2" })
    .mockRejectedValueOnce(new Error("temporary offline"))
    .mockResolvedValueOnce({ annotations: annotations.slice(29, 60), nextCursor: "page-3" })
    .mockResolvedValueOnce({ annotations: annotations.slice(60), nextCursor: null });
  const { result } = renderHook(() => usePlazaFeed({ filters: { sort: "latest" }, actorKey: "actor-a", refresh: 0 }));
  await waitFor(() => expect(result.current.annotations).toHaveLength(30));
  await act(() => result.current.loadMore());
  expect(result.current.error).toBe("temporary offline");
  expect(result.current.annotations).toHaveLength(30);
  await act(() => result.current.loadMore());
  expect(result.current.annotations).toHaveLength(60);
  await act(() => result.current.loadMore());
  expect(result.current.annotations.map(({ id }) => id)).toEqual(annotations.map(({ id }) => id));
  expect(result.current.nextCursor).toBeNull();
  expect(communityApi.plazaPage).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor: "page-2" }), expect.any(AbortSignal));
  expect(communityApi.plaza).not.toHaveBeenCalled();
});

test("preserves every legacy filter and recommended ranking instead of dropping unsupported page filters", async () => {
  vi.mocked(communityApi.plaza).mockResolvedValue({ annotations: [], filters: {} });
  const filters: PlazaFilters = { sort: "latest", institution: "Institute", educationStage: "PhD", documentType: "paper", query: "/systems", literatureIdentityKind: "doi", literatureIdentityValue: "10.test/a", literatureId: "lit" };
  const { result, rerender } = renderHook(({ filters }) => usePlazaFeed({ filters, actorKey: "a", refresh: 0 }), { initialProps: { filters } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(communityApi.plaza).toHaveBeenCalledWith(filters, expect.any(AbortSignal));
  expect(result.current.legacyFilterNotice).toBeTruthy();
  rerender({ filters: { sort: "recommended" } });
  await waitFor(() => expect(communityApi.plaza).toHaveBeenCalledTimes(2));
  expect(result.current.legacyFilterNotice).toBe("");
  expect(communityApi.plazaPage).not.toHaveBeenCalled();
});

test("query and actor changes discard cursors, abort pending requests, and ignore late responses", async () => {
  let finish!: (value: { annotations: CommunityAnnotation[]; nextCursor: string }) => void;
  vi.mocked(communityApi.plazaPage).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ annotations: [], nextCursor: null });
  const { result, rerender } = renderHook(({ actorKey, filters }) => usePlazaFeed({ filters, actorKey, refresh: 0 }), { initialProps: { actorKey: "a", filters: { sort: "latest" } as PlazaFilters } });
  rerender({ actorKey: "b", filters: { sort: "latest", literatureId: "new" } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { finish({ annotations, nextCursor: "old-cursor" }); });
  expect(result.current.annotations).toEqual([]);
  expect(result.current.nextCursor).toBeNull();
  expect(vi.mocked(communityApi.plazaPage).mock.calls[0][1]?.aborted).toBe(true);
  expect(vi.mocked(communityApi.plazaPage).mock.calls[1][0]).not.toHaveProperty("cursor");
});

test("authorization failure clears previously loaded bodies rather than leaving a cached result", async () => {
  vi.mocked(communityApi.plazaPage).mockResolvedValueOnce({ annotations: annotations.slice(0, 30), nextCursor: "page-2" }).mockRejectedValueOnce(new CommunityRequestError(403, "ACCESS_DENIED", "无权访问", {}));
  const { result } = renderHook(() => usePlazaFeed({ filters: { sort: "latest" }, actorKey: "a", refresh: 0 }));
  await waitFor(() => expect(result.current.annotations).toHaveLength(30));
  await act(() => result.current.loadMore());
  expect(result.current.annotations).toEqual([]);
  expect(result.current.nextCursor).toBeNull();
});

test("back navigation re-fetches all visited pages before restoring scroll without persisting bodies", async () => {
  vi.mocked(communityApi.plazaPage).mockResolvedValueOnce({ annotations: annotations.slice(0, 30), nextCursor: "page-2" }).mockResolvedValueOnce({ annotations: annotations.slice(30, 60), nextCursor: "page-3" });
  const first = renderHook(() => usePlazaFeed({ filters: { sort: "latest" }, actorKey: "a", refresh: 0 }));
  await waitFor(() => expect(first.result.current.annotations).toHaveLength(30));
  await act(() => first.result.current.loadMore());
  Object.defineProperty(window, "scrollY", { configurable: true, value: 480 });
  act(() => window.dispatchEvent(new Event("scroll")));
  expect(JSON.stringify(history.state)).not.toContain("Authorized synthetic");
  first.unmount();
  vi.mocked(communityApi.plazaPage).mockResolvedValueOnce({ annotations: annotations.slice(1, 31), nextCursor: "fresh-2" }).mockResolvedValueOnce({ annotations: annotations.slice(31, 60), nextCursor: null });
  const back = renderHook(() => usePlazaFeed({ filters: { sort: "latest" }, actorKey: "a", refresh: 0 }));
  await waitFor(() => expect(back.result.current.annotations).toHaveLength(59));
  expect(back.result.current.annotations.some(({ id }) => id === "authorized-1")).toBe(false);
  expect(window.scrollTo).toHaveBeenCalledWith(0, 480);
});
