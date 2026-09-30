import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useLiteratureGuide } from "../app/features/paper-reading/useLiteratureGuide";
import type { GuideBatch, GuideGenerator } from "../app/features/paper-reading/literatureGuide";

const batch: GuideBatch = { level: "balanced", rejected: 0, items: [{ page: 1, quote: "source", title: "术语", explanation: "简明讲解", category: "term" }] };
function setup(generate: GuideGenerator = async () => batch) {
  return { scope: "paper-a", title: "A", pageCount: 7, ready: true, count: 0, generate,
    readPage: vi.fn(async (page: number) => `source page ${page}`), save: vi.fn(async () => 1), clear: vi.fn(async () => {}) };
}

test("processes bounded sequential text batches and resumes after a failure without regenerating completed pages", async () => {
  let fail = true;
  const generate = vi.fn<GuideGenerator>(async (request) => { if (request.pages[0].page === 4 && fail) throw new Error("provider unavailable"); return batch; });
  const props = setup(generate);
  const { result } = renderHook(() => useLiteratureGuide(props));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(props.save).toHaveBeenCalledTimes(1);
  expect(result.current.message).toContain("第 4 页继续");
  fail = false;
  act(() => result.current.start());
  await waitFor(() => expect(result.current.message).toContain("7/7 页"));
  expect(generate.mock.calls.map(([request]) => request.pages.map((page) => page.page))).toEqual([[1, 2, 3], [4, 5, 6], [4, 5, 6], [7]]);
  expect(result.current.error).toBe("");
});

test("cancels on a paper switch and refuses to save a late answer to either paper", async () => {
  let resolve!: (value: GuideBatch) => void;
  const generate = vi.fn<GuideGenerator>(() => new Promise((done) => { resolve = done; }));
  const props = setup(generate);
  const { result, rerender } = renderHook(({ scope }) => useLiteratureGuide({ ...props, scope }), { initialProps: { scope: "paper-a" } });
  act(() => result.current.start());
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  rerender({ scope: "paper-b" });
  expect(generate.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => resolve(batch));
  expect(props.save).not.toHaveBeenCalled();
  expect(result.current.message).toBe(""); expect(result.current.busy).toBe(false);
});

test("manual cancellation preserves completed work and stops late model output", async () => {
  let resolve!: (value: GuideBatch) => void;
  const generate = vi.fn<GuideGenerator>(() => new Promise((done) => { resolve = done; }));
  const props = setup(generate);
  const { result } = renderHook(() => useLiteratureGuide(props));
  act(() => result.current.start());
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  act(() => result.current.cancel());
  await act(async () => resolve(batch));
  expect(props.save).not.toHaveBeenCalled(); expect(result.current.error).toBe("");
  expect(result.current.busy).toBe(false);
});

test("a cancelled run cannot replace a newer run's status after returning to the same paper", async () => {
  let finishOld!: (value: GuideBatch) => void;
  const generate = vi.fn<GuideGenerator>().mockImplementationOnce(() => new Promise((done) => { finishOld = done; })).mockResolvedValue(batch);
  const props = { ...setup(generate), pageCount: 3 };
  const { result, rerender } = renderHook(({ scope }) => useLiteratureGuide({ ...props, scope }), { initialProps: { scope: "paper-a" } });
  act(() => result.current.start());
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  rerender({ scope: "paper-b" }); rerender({ scope: "paper-a" });
  act(() => result.current.start());
  await waitFor(() => expect(result.current.message).toContain("3/3 页"));
  const completed = result.current.message;
  await act(async () => finishOld(batch));
  expect(result.current.message).toBe(completed);
  expect(props.save).toHaveBeenCalledTimes(1);
});

test("cannot erase good annotations with a completely ungrounded model batch", async () => {
  const props = setup(async () => ({ level: "balanced", rejected: 3, items: [] }));
  const { result } = renderHook(() => useLiteratureGuide(props));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.error).toContain("原有标注已保留"));
  expect(props.save).not.toHaveBeenCalled();
});

test("limits a pass to sixty pages, skips image-only text, and continues explicitly", async () => {
  const props = setup(vi.fn(async () => batch));
  const { result } = renderHook(() => useLiteratureGuide({ ...props, pageCount: 65, readPage: async (page) => page === 1 ? "" : `source ${page}` }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.message).toContain("60/65 页；点击继续标注"));
  expect(result.current.message).toContain("1 页无可用文本");
  act(() => result.current.start());
  await waitFor(() => expect(result.current.message).toContain("65/65 页"));
});

test("captures options for every batch and save, resets resume on changes, and refuses an empty focus selection", async () => {
  const generate = vi.fn<GuideGenerator>().mockResolvedValueOnce(batch).mockRejectedValueOnce(new Error("retry"));
  const props = setup(generate);
  const { result } = renderHook(() => useLiteratureGuide(props));
  const options = { systemPrompt: "只讲关键假设", categories: ["reasoning" as const], existing: "append" as const };
  act(() => result.current.setOptions(options));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.error).toBe("retry"));
  expect(result.current.resume).toBe(true);
  expect(generate.mock.calls[0][0]).toMatchObject(options);
  expect(props.save.mock.calls[0].at(-1)).toEqual(options);
  act(() => result.current.setOptions({ ...options, categories: [] }));
  expect(result.current.resume).toBe(false);
  act(() => result.current.start());
  expect(generate).toHaveBeenCalledTimes(2);
});
