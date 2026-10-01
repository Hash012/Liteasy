import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useTasksController } from "../app/controllers/useTasksController";
import { taskClient, type TaskSnapshot } from "../app/features/tasks/taskClient";

vi.mock("../app/platform/native", () => ({ hasNativeHost: () => true }));
vi.mock("../app/features/tasks/taskClient", () => ({ taskClient: { snapshot: vi.fn(), enqueue: vi.fn(), cancel: vi.fn() } }));
afterEach(() => vi.resetAllMocks());
const empty: TaskSnapshot = { devices: [], pairs: [], tasks: [], outbox: [] };

test("a slow poll cannot block local enqueue/cancel or erase their durable acknowledgements", async () => {
  let finish!: (value: TaskSnapshot) => void;
  vi.mocked(taskClient.snapshot).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(taskClient.enqueue).mockImplementation(async (_scope, input) => ({ ...input, status: "pending-send", createdAt: Date.now() }));
  const { result } = renderHook(() => useTasksController("account:a"));
  await act(async () => { await result.current.enqueue("desktop", "sync-library"); });
  expect(result.current.busy).toBe(false);
  expect(result.current.snapshot.outbox).toHaveLength(1);
  const task = result.current.snapshot.outbox[0];
  const cancelled = { ...empty, outbox: [{ ...task, cancelRequested: true }] };
  vi.mocked(taskClient.cancel).mockResolvedValue(cancelled);
  await act(async () => { await result.current.cancel(task); });
  expect(result.current.busy).toBe(false);
  expect(result.current.snapshot.outbox[0].cancelRequested).toBe(true);
  expect(taskClient.snapshot).toHaveBeenCalledTimes(1);
  await act(async () => { finish(empty); });
  expect(result.current.snapshot.outbox).toEqual(cancelled.outbox);
});

test("late status from a previous account never replaces the current account", async () => {
  let finish!: (value: TaskSnapshot) => void;
  vi.mocked(taskClient.snapshot).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ ...empty, offline: true });
  const { result, rerender } = renderHook(({ scope }) => useTasksController(scope), { initialProps: { scope: "account:a" } });
  rerender({ scope: "account:b" });
  await waitFor(() => expect(result.current.snapshot.offline).toBe(true));
  await act(async () => { finish(empty); });
  expect(result.current.snapshot.offline).toBe(true);
});
