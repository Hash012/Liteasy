import { invoke, isTauri } from "@tauri-apps/api/core";
import { getRegisteredActionPolicy } from "../actions/actionPolicy";

export type CopyItemStatus = "pending" | "committing" | "committed" | "failed" | "conflict" | "uncertain" | "undoing" | "undone" | "undo_conflict";
export type LocalCopyTask = {
  id: string;
  actionId: "local_files.copy";
  planDigest: string;
  sourceMountId: string;
  destinationMountId: string;
  sourceRoot: string;
  destinationRoot: string;
  outputDirectory: string;
  confirmed: boolean;
  cancelled: boolean;
  undoRequested: boolean;
  status: "preview" | "running" | "completed" | "partial" | "cancelled" | "undoing" | "undone";
  totalBytes: number;
  items: Array<{
    sourcePath: string;
    outputPath: string;
    sourceRevision: string;
    byteLength: number;
    status: CopyItemStatus;
    attempts: number;
    receiptRevision: string | null;
    backupPath: string | null;
    message: string | null;
  }>;
};
export type LocalCopyPlanInput = {
  sourceMountId: string;
  destinationMountId: string;
  paths: string[];
  idempotencyKey: string;
};
export type LocalFileOperationsService = {
  available: boolean;
  list(): Promise<LocalCopyTask[]>;
  plan(input: LocalCopyPlanInput): Promise<LocalCopyTask>;
  command(operation: "get" | "confirm" | "retry" | "cancel" | "step" | "confirmUndo" | "undoStep", task: LocalCopyTask): Promise<LocalCopyTask>;
};

/** Fixed action and native grant IDs. Document content is never an instruction. */
export function createLocalFileOperationsService(scope: string, currentScope: () => string): LocalFileOperationsService {
  const check = () => {
    if (scope !== currentScope()) throw new Error("账号已切换，请重新打开文件任务。");
    if (!isTauri()) throw new Error("此操作需要桌面应用授权本地文件夹。");
  };
  const call = async <T,>(operation: string, args = {}): Promise<T> => {
    check();
    try {
      const result = await invoke<T>("note_files_dispatch", { scope, request: { action: "operations", operation, ...args } });
      check();
      return result;
    } catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
  };
  return {
    available: isTauri(),
    list: () => call("list"),
    plan: (input) => call("plan", input),
    command: (operation, task) => {
      const policy = getRegisteredActionPolicy(task.actionId);
      if (policy.actionId !== "local_files.copy" || !policy.requiresConfirmation) throw new Error("此文件动作未注册。");
      return call(operation, { taskId: task.id, planDigest: task.planDigest });
    },
  };
}

/** A single outstanding commit is the cancellation boundary. No speculative queue. */
export function createLocalCopyRunner(service: LocalFileOperationsService) {
  let stopRequested = false;
  let active = false;
  let last: LocalCopyTask | null = null;
  return {
    cancel() { stopRequested = true; },
    async run(task: LocalCopyTask, start: "confirm" | "retry" | "confirmUndo", changed: (task: LocalCopyTask) => void) {
      if (active) throw new Error("文件任务正在执行。");
      active = true;
      stopRequested = false;
      last = task;
      try {
        last = await service.command(start, task);
        changed(last);
        while (!stopRequested && (last.status === "running" || last.status === "undoing")) {
          last = await service.command(last.undoRequested ? "undoStep" : "step", last);
          changed(last);
        }
        if (stopRequested) {
          last = await service.command("cancel", last);
          changed(last);
        }
        return last;
      } finally { active = false; }
    },
  };
}
