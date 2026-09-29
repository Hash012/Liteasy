import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useProfileMemory, type ProfileMemoryGenerator } from "../app/features/profile/useProfileMemory";
import { loadProfileMemory } from "../app/features/profile/profileMemory";
const message = "我主要研究分布式数据库";
const output = JSON.stringify({ updates: [{ field: "research_topic", value: "分布式数据库", evidence: message, confidence: 0.99, replacesId: null }] });
beforeEach(() => localStorage.clear());

test("checks after a completed preference statement, deduplicates retries and saves real model proposals", async () => {
  const generate = vi.fn(async () => output);
  const { result } = renderHook(() => useProfileMemory({ scope: "guest", enabled: true, generate }));
  const turn = { message, sessionId: "chat", requestId: "r1" };
  await act(() => result.current.observeTurn(turn));
  expect(generate).toHaveBeenCalledTimes(1);
  expect(result.current.data.entries[0].value).toBe("分布式数据库");
  expect(result.current.notice).toContain("记住 1 项");
  await act(() => result.current.observeTurn(turn));
  await act(() => result.current.observeTurn({ ...turn, requestId: "r2" }));
  expect(generate).toHaveBeenCalledTimes(1);
});

test("greetings do not call a model and disabled personalization collects nothing", async () => {
  const generate = vi.fn(async () => output);
  const { result, rerender } = renderHook(({ enabled }) => useProfileMemory({ scope: "guest", enabled, generate }), { initialProps: { enabled: true } });
  await act(() => result.current.observeTurn({ message: "hello", sessionId: "s", requestId: "r1" }));
  expect(generate).not.toHaveBeenCalled();
  rerender({ enabled: false });
  await act(() => result.current.observeTurn({ message, sessionId: "s", requestId: "r2" }));
  expect(generate).not.toHaveBeenCalled();
  expect(result.current.data.entries).toEqual([]);
});

test("does not write a delayed proposal after account switch or manual changes", async () => {
  let finish!: (answer: string) => void;
  const generate: ProfileMemoryGenerator = () => new Promise((resolve) => { finish = resolve; });
  const { result, rerender } = renderHook(({ scope }) => useProfileMemory({ scope, enabled: true, generate }), { initialProps: { scope: "a" } });
  let pending!: Promise<void>;
  act(() => { pending = result.current.observeTurn({ message, sessionId: "s", requestId: "r1" }); });
  rerender({ scope: "b" });
  await act(async () => { finish(output); await pending; });
  expect(loadProfileMemory("a").data.entries).toEqual([]);
  expect(result.current.data.entries).toEqual([]);
  act(() => { pending = result.current.observeTurn({ message, sessionId: "s", requestId: "r2" }); });
  act(() => result.current.saveEntry("research_topic", "information retrieval"));
  await act(async () => { finish(output); await pending; });
  expect(result.current.data.entries.map((entry) => entry.value)).toEqual(["information retrieval"]);
});

test("pausing or clearing during a check aborts it and prevents late restoration", async () => {
  let finish!: (answer: string) => void;
  let signal!: AbortSignal;
  const generate: ProfileMemoryGenerator = (input) => new Promise((resolve) => { finish = resolve; signal = input.signal; });
  const { result } = renderHook(() => useProfileMemory({ scope: "guest", enabled: true, generate }));
  let pending!: Promise<void>;
  act(() => { pending = result.current.observeTurn({ message, sessionId: "s", requestId: "r1" }); });
  act(() => result.current.clear());
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(output); await pending; });
  expect(result.current.data.entries).toEqual([]);
  expect(result.current.data.automatic).toBe(false);
});

test("manual editing, deletion, and refresh preserve the local structured store", () => {
  const first = renderHook(() => useProfileMemory({ scope: "guest", enabled: true }));
  act(() => first.result.current.saveEntry("response_style", "先给结论"));
  const id = first.result.current.data.entries[0].id;
  act(() => first.result.current.saveEntry("response_style", "简短回答", id));
  expect(first.result.current.data.entries).toHaveLength(1);
  first.unmount();
  const restored = renderHook(() => useProfileMemory({ scope: "guest", enabled: true }));
  expect(restored.result.current.data.entries[0].value).toBe("简短回答");
  act(() => restored.result.current.removeEntry(id));
  expect(restored.result.current.data.blocked).toContain("response_style:简短回答");
});

test("model errors are contained and count toward the check budget", async () => {
  const generate = vi.fn(async () => { throw new Error("offline"); });
  const { result } = renderHook(() => useProfileMemory({ scope: "guest", enabled: true, generate }));
  await act(() => result.current.observeTurn({ message, sessionId: "s", requestId: "r1" }));
  expect(result.current.data.entries).toEqual([]);
  expect(result.current.data.cadence.dailyChecks).toBe(1);
});
