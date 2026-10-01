import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRecommendationFullText } from "../app/features/recommendations/useRecommendationFullText";
import { RecommendationList } from "../app/features/recommendations/RecommendationList";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
const discover = vi.hoisted(() => vi.fn());
vi.mock("../app/features/paper-services/paperPdfResolver", async (original) => ({ ...await original<object>(), discoverPaperPdfUrl: discover }));
afterEach(() => vi.resetAllMocks());
const item = (n: number) => ({ id: `doi:10.1234/test-${n}`, title: `Paper ${n}`, authors: [], source: "crossref" }) as RecommendationItem;

test("full-text filter lazily resolves missing metadata and passes the discovered PDF into open/save", async () => {
  const onOpen = vi.fn();
  discover.mockResolvedValue("https://repository.test/paper.pdf");
  render(<RecommendationList items={[item(1)]} canSave pendingIds={[]} onOpen={onOpen} onSave={() => {}} onDismiss={() => {}} />);
  expect(discover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "可获取全文" }));
  await waitFor(() => expect(discover).toHaveBeenCalledOnce());
  const row = await screen.findByRole("button", { name: "查看推荐 Paper 1" });
  fireEvent.doubleClick(row);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ openAccessAvailable: true, openAccessPdfUrl: "https://repository.test/paper.pdf" }));
});

test("checks at most three papers at once, caches completed results, and aborts unfinished work", async () => {
  const finish: Array<(url?: string) => void> = [];
  discover.mockImplementation(() => new Promise<string | undefined>((resolve) => finish.push(resolve)));
  const items = Array.from({ length: 6 }, (_, n) => item(n));
  const { result, rerender, unmount } = renderHook(({ enabled }) => useRecommendationFullText(items, enabled), { initialProps: { enabled: true } });
  expect(discover).toHaveBeenCalledTimes(3); expect(result.current.pending).toBe(6);
  await act(async () => finish[0]("https://repository.test/paper.pdf"));
  expect(discover).toHaveBeenCalledTimes(4); expect(result.current.items[0].openAccessAvailable).toBe(true);
  rerender({ enabled: false });
  expect(discover.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => finish[1]("https://repository.test/late.pdf"));
  expect(result.current.items[1].openAccessAvailable).toBeUndefined();
  rerender({ enabled: true });
  expect(discover).toHaveBeenCalledTimes(7);
  expect(discover.mock.calls.slice(4).some(([source]) => source.id === items[0].id)).toBe(false);
  unmount(); expect(discover.mock.calls[6][1].signal.aborted).toBe(true);
});

test("source failures are retryable and known arXiv papers are available without any query", async () => {
  discover.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("https://repo.test/paper.pdf");
  const items = [item(1), { ...item(2), id: "arxiv:2402.12482" }];
  const { result } = renderHook(() => useRecommendationFullText(items, true));
  await waitFor(() => expect(result.current.failed).toBe(1));
  expect(result.current.items[1].openAccessPdfUrl).toBe("https://arxiv.org/pdf/2402.12482");
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.items[0].openAccessAvailable).toBe(true));
});
