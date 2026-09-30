import { nativeRequest } from "../../platform/native";

export type TaskKind = "open-document" | "extract-text" | "summarize-document" | "sync-library";
export type RemoteDevice = { deviceId: string; name: string; online: boolean; capabilities: TaskKind[]; lastSeen: number };
export type RemoteTask = { taskId?: string; operationId: string; desktopId: string; kind: TaskKind; status: string; createdAt: number; updatedAt?: number;
  document?: { documentId: string; contentHash: string; title: string }; cancelRequested?: boolean; result?: { text?: string; message?: string; pages?: number; artifactId?: string }; error?: string; progress?: number };
export type TaskSnapshot = { devices: RemoteDevice[]; pairs: { pairId: string; desktopId: string }[]; tasks: RemoteTask[]; outbox: RemoteTask[]; offline?: boolean; error?: string };
export const taskClient = {
  snapshot: (scope: string) => nativeRequest<TaskSnapshot>("tasksSnapshot", { scope }),
  pair: (scope: string, code: string) => nativeRequest<TaskSnapshot>("pairDesktop", { scope, code }),
  unpair: (scope: string, pairId: string) => nativeRequest<TaskSnapshot>("unpairDesktop", { scope, pairId }),
  enqueue: (scope: string, input: Omit<RemoteTask, "createdAt" | "status">) => nativeRequest<RemoteTask>("enqueueTask", { scope, input }),
  cancel: (scope: string, task: RemoteTask) => nativeRequest<TaskSnapshot>("cancelTask", { scope, operationId: task.operationId, taskId: task.taskId }),
  retry: (scope: string) => nativeRequest("retryTaskOutbox", { scope })
};
