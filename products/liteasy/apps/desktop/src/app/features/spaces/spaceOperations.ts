import type { PublicationActorBinding } from "../forum/publicationActorBinding";
import { samePublicationActor } from "../forum/publicationActorBinding";
import type { PdfAnnotationPublication } from "../pdf/pdfAnnotationStorage";
import type { ThinReadingAnnotation } from "../thin-reading/thinReading.types";
import type { CloudLibraryScope } from "../library/cloudLibraryStorageClient";

export type SpaceOperation = {
  id: string; title: string; domain: "transfer" | "publication" | "notification";
  status: string; audience: string; detail: string;
  actionLabel?: string; open?: () => void;
};
export type TransferOperationEvent = {
  id: string; actorKey?: string; generation: string; title: string; target?: CloudLibraryScope;
  phase: "running" | "completed" | "cancelled" | "failed" | "unknown";
  error?: unknown;
};
export function operationRecovery(error: unknown) {
  const value = error as { status?: number; code?: string; message?: string } | undefined;
  const text = value?.message ?? "";
  if (value?.status === 401 || /登录|身份|会话|account_session/.test(`${text} ${value?.code}`)) return "身份已变化，请重新登录后核对原操作。";
  if (value?.status === 403 || /权限|允许|角色|forbidden/i.test(text)) return "当前权限不足，请在组织空间刷新权限或联系所有者。";
  if (value?.status === 413 || /配额|quota|空间不足/i.test(`${text} ${value?.code}`)) return "存储配额不足，请在目标文库检查用量后再操作。";
  if (value?.status === 409 || /版本|revision|conflict/i.test(`${text} ${value?.code}`)) return "内容版本有冲突，请重新打开目标并核对改动，不要直接覆盖。";
  if (/来源|文献身份|source|literature/i.test(text)) return "来源尚未确认，请在阅读器确认文献信息后继续。";
  return "连接或回执不可用，请先检查网络并核对目标中的原操作，避免重复提交。";
}
export function projectTransfer(event: TransferOperationEvent): SpaceOperation {
  const audience = !event.target ? "本机文件" : event.target.scopeType === "organization" ? `组织 · ${event.target.scopeId}` : "个人云 · 仅本人";
  const status = { running: "正在处理", completed: "已保存", cancelled: "已取消本次转移", failed: "未完成", unknown: "待核实" }[event.phase];
  return { id: event.id, title: event.title, domain: "transfer", status, audience,
    detail: event.phase === "running" ? "正在等待服务回执；上传暂存不代表已可读取。" : event.phase === "completed" ? "目标文库已返回完成回执。保存到云端不会自动公开。"
      : event.phase === "cancelled" ? "未继续本次转移；这不会撤回已有远端副本。" : operationRecovery(event.error), actionLabel: "核对目标文库" };
}
export function projectPdfPublication(input: { id: string; title: string; publication?: PdfAnnotationPublication; actor?: PublicationActorBinding }): SpaceOperation | null {
  const p = input.publication;
  if (!p || !input.actor || !samePublicationActor(p.actorBinding, input.actor, { includeGeneration: false })) return null;
  if (p.state === "not_published" && !p.remoteAnnotationId && !p.pendingOperation) return null;
  const retract = p.pendingOperation?.operation === "retract" || p.state === "pending_retract";
  const unknown = p.outcome === "unknown";
  const status = retract ? "待撤回" : unknown ? "待核实" : p.state === "published" ? "已发布" : p.state === "failed" ? "未完成" : p.state === "not_published" ? "已撤回" : "待发布";
  return { id: input.id, title: input.title, domain: "publication", status,
    audience: status === "已撤回" ? "仅本人 · 远端副本已撤回" : p.remoteAnnotationId || p.desiredVisibility === "public" ? "公开 · 不进入广场仍可被公开访问" : "仅本人",
    detail: retract ? "远端撤回尚未确认，请在原批注中核实。" : unknown ? "服务可能已接收原请求；请只读核实原操作。" : p.lastError ? operationRecovery({ message: p.lastError }) : "本机批注与 Intuecho 发布副本分别保存。",
    actionLabel: unknown || retract ? "打开批注核实" : "打开原批注" };
}
export function projectThinPublication(input: { id: string; title: string; annotation: ThinReadingAnnotation; actor?: PublicationActorBinding }): SpaceOperation | null {
  const a = input.annotation, p = a.publication;
  if (!p || !input.actor || !samePublicationActor(p.actorBinding, input.actor, { includeGeneration: false })) return null;
  if (p.retractReceipt?.state === "retracted") return { id: input.id, title: input.title, domain: "publication", status: "已撤回", audience: "仅本人", detail: "Intuecho 已返回撤回回执；本机原件保留。", actionLabel: "打开原批注" };
  return projectPdfPublication({ ...input, publication: { actorBinding: p.actorBinding, desiredVisibility: a.visibility === "private" ? "private" : "public",
    state: p.pendingRetract ? "pending_retract" : a.syncState?.status === "synced" ? "published" : a.syncState?.status === "failed" ? "failed" : "pending_create",
    remoteAnnotationId: p.remoteAnnotationId, outcome: p.outcome, ...(a.syncState?.status === "failed" ? { lastError: a.syncState.error } : {}) } });
}
