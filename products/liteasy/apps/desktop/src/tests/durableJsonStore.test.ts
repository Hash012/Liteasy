import { beforeEach, expect, test, vi } from "vitest";

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  isTauri.mockReturnValue(true);
  localStorage.clear();
});

test("coalesces streaming checkpoints while a native write is busy and saves the latest revision", async () => {
  let releaseWrite!: () => void;
  const snapshots: Record<string, unknown>[] = [];
  invoke.mockImplementation(async (command, args) => {
    if (command === "load_workflow_checkpoints") return {};
    snapshots.push(args.snapshot);
    if (snapshots.length === 1) await new Promise<void>((resolve) => { releaseWrite = resolve; });
  });
  const { putDurableEntry, loadDurableEntries } = await import("../app/features/persistence/durableJsonStore");
  const first = putDurableEntry("artifact-tasks", "account", { answer: "开始" });
  await vi.waitFor(() => expect(snapshots).toHaveLength(1));
  const updates = Array.from({ length: 200 }, (_, index) =>
    putDurableEntry("artifact-tasks", "account", { answer: `最新草稿 ${index}` })
  );
  await Promise.resolve();
  expect(snapshots).toHaveLength(1);
  releaseWrite();
  await Promise.all([first, ...updates]);
  expect(snapshots).toEqual([
    { account: { answer: "开始" } },
    { account: { answer: "最新草稿 199" } }
  ]);
  expect(await loadDurableEntries("artifact-tasks")).toEqual(snapshots[1]);
});

test("allows a later checkpoint to recover after a failed native save", async () => {
  const diskSave = vi.fn().mockRejectedValueOnce(new Error("disk busy")).mockResolvedValue(undefined);
  invoke.mockImplementation(async (command, args) =>
    command === "load_workflow_checkpoints" ? {} : diskSave(args.snapshot)
  );
  const { putDurableEntry } = await import("../app/features/persistence/durableJsonStore");
  await expect(putDurableEntry("thin-reading", "node", { answer: "初始草稿" })).rejects.toThrow("disk busy");
  await expect(putDurableEntry("thin-reading", "node", { answer: "修订草稿" })).resolves.toBeUndefined();
  expect(diskSave).toHaveBeenLastCalledWith({ node: { answer: "修订草稿" } });
});

test("keeps checkpoint scopes independent and retains account entries during coalescing", async () => {
  isTauri.mockReturnValue(false);
  const { putDurableEntry } = await import("../app/features/persistence/durableJsonStore");
  await Promise.all([
    putDurableEntry("artifact-tasks", "account-a", { answer: "A" }),
    putDurableEntry("artifact-tasks", "account-b", { answer: "B" }),
    putDurableEntry("thin-reading", "node-a", { answer: "正文" })
  ]);
  await putDurableEntry("artifact-tasks", "account-a", undefined);
  expect(JSON.parse(localStorage.getItem("liteasy.checkpoints.v1:artifact-tasks")!)).toEqual({ "account-b": { answer: "B" } });
  expect(JSON.parse(localStorage.getItem("liteasy.checkpoints.v1:thin-reading")!)).toEqual({ "node-a": { answer: "正文" } });
});
