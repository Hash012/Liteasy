import { isTauri } from "@tauri-apps/api/core";
import type { ArtifactExportOutcome, ArtifactExportPayload } from "../artifacts/artifactExport.types";
import { renderExportDocument } from "./documentExportService";
import { defaultExportOptions, type DocumentFormat, type ExportDocument, type ExportOptions } from "./documentExport.types";
export type ExportJob = {
  id: string; format: DocumentFormat; options: ExportOptions; document?: ExportDocument; payload?: ArtifactExportPayload;
  status: "idle" | "compiling" | "review" | "rendering" | "ready" | "saving" | "saved" | "failed" | "cancelled";
  accepted: boolean; error: string; controller?: AbortController; outcome?: ArtifactExportOutcome;
  listeners: Set<() => void>;
};
// Only explicitly scoped callers use this bounded, in-memory view restoration cache.
// No content is persisted here and it never changes the existing export pipeline owner.
const retained = new Map<string, ExportJob>();
const MAX_RETAINED_JOBS = 8;
export const exportJobBusy = (job: ExportJob) => ["compiling", "rendering", "saving"].includes(job.status);
export function createExportJob(format: DocumentFormat, options: ExportOptions = defaultExportOptions): ExportJob {
  return { id: crypto.randomUUID(), format, options: { ...options, nodeIds: options.nodeIds ? [...options.nodeIds] : undefined }, status: "idle", accepted: false, error: "", listeners: new Set() };
}
export function restoreExportJob(identity: string | undefined, format: DocumentFormat) {
  const existing = identity ? retained.get(identity) : undefined;
  if (existing) return existing;
  const job = createExportJob(format);
  retainExportJob(identity, job);
  return job;
}
export function retainExportJob(identity: string | undefined, job: ExportJob) {
  if (!identity) return;
  if (!retained.has(identity) && retained.size >= MAX_RETAINED_JOBS) {
    const removable = [...retained].find(([, value]) => !exportJobBusy(value) && value.listeners.size === 0);
    if (removable) retained.delete(removable[0]);
    else return; // Active jobs keep running; an extra view may proceed without retention.
  }
  retained.delete(identity); retained.set(identity, job);
}
export function notifyExportJob(job: ExportJob) { job.listeners.forEach(listener => listener()); }
export function cancelExportJob(job: ExportJob) {
  if (job.status === "saving") return; // The native destination dialog owns cancellation after publish starts.
  job.controller?.abort(); job.status = "cancelled"; job.payload = undefined;
  job.error = "导出已取消，尚未发布文件。"; notifyExportJob(job);
}
export async function prepareExportJob(job: ExportJob, compile: (options: Partial<ExportOptions>, signal: AbortSignal) => Promise<ExportDocument>) {
  if (exportJobBusy(job) || job.status === "cancelled" || job.payload) return;
  const controller = new AbortController(); job.controller = controller; job.status = "compiling"; job.error = ""; notifyExportJob(job);
  try {
    const document = job.document ?? await compile(job.options, controller.signal);
    controller.signal.throwIfAborted();
    job.document = document;
    if (job.format === "docx") { const { preflightDocx } = await import("./documentDocx"); preflightDocx(document); }
    controller.signal.throwIfAborted();
    if (document.diagnostics.some(issue => issue.severity === "error") || document.diagnostics.length > 0 && !job.accepted) { job.status = "review"; return; }
    document.options = { ...document.options, acceptDegradations: job.accepted };
    if (job.format === "pdf" && !isTauri()) { job.status = "ready"; return; }
    job.status = "rendering"; notifyExportJob(job);
    const payload = await renderExportDocument(document, job.format, controller.signal);
    controller.signal.throwIfAborted();
    job.payload = payload; job.status = "ready";
  } catch (error) {
    if (!controller.signal.aborted) { job.error = error instanceof Error ? error.message : "导出失败。"; job.status = "failed"; }
  } finally { if (job.controller === controller) { job.controller = undefined; notifyExportJob(job); } }
}
export async function publishExportJob(job: ExportJob, publish: (payload: ArtifactExportPayload, signal?: AbortSignal) => Promise<ArtifactExportOutcome>) {
  if (!job.payload || exportJobBusy(job) || job.status === "cancelled") return undefined;
  const controller = new AbortController(); job.controller = controller; job.status = "saving"; job.error = ""; notifyExportJob(job);
  try {
    await job.document?.assertAuthorized?.(); controller.signal.throwIfAborted();
    const outcome = await publish(job.payload, controller.signal);
    job.outcome = outcome; job.status = outcome.status === "cancelled" ? "ready" : "saved";
    return outcome;
  } catch (error) { job.status = "failed"; job.error = error instanceof Error ? error.message : "保存失败。"; return undefined; }
  finally { if (job.controller === controller) { job.controller = undefined; notifyExportJob(job); } }
}
