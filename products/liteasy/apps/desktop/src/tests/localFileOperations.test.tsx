import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { LocalFileOperationsTool } from "../app/controllers/LocalFileOperationsTool";
import { createLocalCopyRunner, createLocalFileOperationsService, type LocalCopyTask, type LocalFileOperationsService } from "../app/features/local-file-operations/localFileOperations";

const native = vi.hoisted(() => ({ available: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.available, invoke: native.invoke }));
beforeEach(() => { native.available = true; native.invoke.mockReset(); });
function task(status: LocalCopyTask["status"] = "preview"): LocalCopyTask {
  return {
    id: "task-one", actionId: "local_files.copy", planDigest: "immutable-preview-digest",
    sourceMountId: "source", destinationMountId: "output", sourceRoot: "/selected/source", destinationRoot: "/selected/output", outputDirectory: "Liteasy-copy-one",
    confirmed: status !== "preview", cancelled: false, undoRequested: false, status, totalBytes: 4,
    items: [{ sourcePath: "note.md", outputPath: "Liteasy-copy-one/note.md", sourceRevision: "original-revision", byteLength: 4,
      status: status === "completed" ? "committed" : "pending", attempts: 0, receiptRevision: null, backupPath: null, message: null }],
  };
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("native commands bind the authenticated scope and exact reviewed digest, never text instructions", async () => {
  let scope = "guest";
  const service = createLocalFileOperationsService("guest", () => scope);
  native.invoke.mockResolvedValue(task());
  await service.plan({ sourceMountId: "source", destinationMountId: "output", paths: ["note.md"], idempotencyKey: "one" });
  await service.command("confirm", task());
  expect(native.invoke).toHaveBeenLastCalledWith("note_files_dispatch", {
    scope: "guest", request: { action: "operations", operation: "confirm", taskId: "task-one", planDigest: "immutable-preview-digest" },
  });
  scope = "user:other";
  await expect(service.command("step", task())).rejects.toThrow("账号已切换");
  expect(native.invoke).toHaveBeenCalledTimes(2);
});

test("a pending result cannot cross an account boundary", async () => {
  let scope = "a";
  const pending = deferred<LocalCopyTask>();
  native.invoke.mockReturnValue(pending.promise);
  const service = createLocalFileOperationsService("a", () => scope);
  const result = service.command("get", task());
  scope = "b";
  pending.resolve(task());
  await expect(result).rejects.toThrow("账号已切换");
});

test("cancel while one item commits records that item and never queues the next", async () => {
  const pending = deferred<LocalCopyTask>();
  const command = vi.fn<LocalFileOperationsService["command"]>()
    .mockResolvedValueOnce(task("running"))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ...task("cancelled"), cancelled: true });
  const service: LocalFileOperationsService = { available: true, list: vi.fn(), plan: vi.fn(), command };
  const runner = createLocalCopyRunner(service);
  const updates = vi.fn();
  const done = runner.run(task(), "confirm", updates);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  runner.cancel();
  const receipt = task("running");
  receipt.items[0].status = "committed";
  receipt.items[0].receiptRevision = "original-revision";
  pending.resolve(receipt);
  await done;
  expect(command.mock.calls.map(([operation]) => operation)).toEqual(["confirm", "step", "cancel"]);
  expect(updates.mock.calls[1][0].items[0].receiptRevision).toBe("original-revision");
});

test("partial item failure stops the runner, and a second run requires explicit retry", async () => {
  const command = vi.fn<LocalFileOperationsService["command"]>()
    .mockResolvedValueOnce(task("running"))
    .mockResolvedValueOnce(task("partial"))
    .mockResolvedValueOnce(task("running"))
    .mockResolvedValueOnce(task("completed"));
  const runner = createLocalCopyRunner({ available: true, list: vi.fn(), plan: vi.fn(), command });
  const partial = await runner.run(task(), "confirm", vi.fn());
  expect(command.mock.calls.map(([operation]) => operation)).toEqual(["confirm", "step"]);
  const completed = await runner.run(partial, "retry", vi.fn());
  expect(completed.status).toBe("completed");
  expect(command.mock.calls.map(([operation]) => operation)).toEqual(["confirm", "step", "retry", "step"]);
});

test("tool selects picker-granted folders and files, previews actual requests, then separately confirms", async () => {
  let picked = 0;
  native.invoke.mockImplementation(async (_command, { request }) => {
    if (request.action === "chooseFolder") { picked++; return { id: picked === 1 ? "source" : "output", kind: "directory", name: "folder", location: picked === 1 ? "/selected/source" : "/selected/output" }; }
    if (request.action === "listEntries") return [
      { mountId: "source", path: "note.md", name: "note.md", kind: "file" },
      { mountId: "source", path: "nested", name: "nested", kind: "directory" },
    ];
    if (request.operation === "list") return [];
    if (request.operation === "plan") return task();
    if (request.operation === "confirm") return task("running");
    if (request.operation === "step") return task("completed");
    throw new Error(`Unexpected request ${JSON.stringify(request)}`);
  });
  render(<LocalFileOperationsTool scope="guest" currentScope={() => "guest"} />);
  fireEvent.click(screen.getByRole("button", { name: "选择来源文件夹" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "note.md" }));
  fireEvent.click(screen.getByRole("button", { name: "选择输出文件夹" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "生成逐文件计划" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "生成逐文件计划" }));
  const preview = await screen.findByLabelText("文件任务计划与回执");
  expect(within(preview).getByText(/note.md → Liteasy-copy-one\/note.md/)).toBeInTheDocument();
  const operations = () => native.invoke.mock.calls.map(([, input]) => input.request.operation).filter(Boolean);
  expect(operations()).toEqual(["list", "plan"]);
  const planRequest = native.invoke.mock.calls.find(([, input]) => input.request.operation === "plan")![1];
  expect(planRequest.request).toMatchObject({ action: "operations", sourceMountId: "source", destinationMountId: "output", paths: ["note.md"] });
  fireEvent.click(screen.getByRole("button", { name: "审查并确认复制" }));
  expect(operations()).toEqual(["list", "plan"]);
  fireEvent.click(screen.getByRole("button", { name: "确认执行此计划" }));
  await waitFor(() => expect(within(preview).getByText("已完成")).toBeInTheDocument());
  expect(operations()).toEqual(["list", "plan", "confirm", "step"]);
});

test("browser capability is unavailable and performs no fake filesystem operation", () => {
  native.available = false;
  render(<LocalFileOperationsTool scope="guest" currentScope={() => "guest"} />);
  expect(screen.getByRole("status")).toHaveTextContent("需要桌面应用");
  expect(screen.queryByRole("button", { name: "选择来源文件夹" })).not.toBeInTheDocument();
  expect(native.invoke).not.toHaveBeenCalled();
});

test("unmount during confirmation cancels before starting any item", async () => {
  const pending = deferred<LocalCopyTask>();
  const command = vi.fn<LocalFileOperationsService["command"]>()
    .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(task("cancelled"));
  const runner = createLocalCopyRunner({ available: true, list: vi.fn(), plan: vi.fn(), command });
  const done = runner.run(task(), "confirm", vi.fn());
  runner.cancel();
  await act(async () => { pending.resolve(task("running")); await done; });
  expect(command.mock.calls.map(([operation]) => operation)).toEqual(["confirm", "cancel"]);
});
