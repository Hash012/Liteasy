import type { NotesItem, NotesTarget } from "./notes.types";
import { notesTargetKey } from "./notes.types";

export const noteLabels = {
  "user-edited": "有用户修改",
  personal: "个人笔记",
  translation: "翻译结果",
  "ai-guide": "AI 导读",
  "ai-generated": "AI 生成",
  excerpt: "原文摘录",
  external: "外部导入",
} as const;
export type NoteLabel = keyof typeof noteLabels;
export type NoteLabelOverrides = Partial<Record<NoteLabel, boolean>>;
export const noteLabelEntries = Object.entries(noteLabels) as [NoteLabel, string][];
export function noteLabelKey(target: NotesTarget): string {
  return notesTargetKey(target.kind === "object" && !target.ref.selectorId
    ? { ...target, followLatest: true } : target);
}
/** Classify from recorded provenance, never from a filename or a timestamp alone. */
export function inferredNoteLabels(item: NotesItem): NoteLabel[] {
  const labels = new Set<NoteLabel>();
  const object = item.object;
  if (item.target.kind === "external-file" || item.source === "extern · 导入笔记") labels.add("external");
  if (object?.kind === "content.note") {
    const payload = object.content.payload;
    if (payload.origin === "external") labels.add("external");
    if (payload.userEditedAt) labels.add("user-edited");
    if (payload.agentEditedAt || object.createdBy.type === "agent" || object.provenance.runId) labels.add("ai-generated");
    if (payload.origin === "user" && object.createdBy.type === "user") labels.add("personal");
  }
  if (object?.kind === "artifact.document" && object.provenance.runId) labels.add("ai-generated");
  if (object?.kind === "content.fragment") labels.add("excerpt");
  const annotation = item.annotation;
  if (annotation) {
    if (annotation.aiGuide) { labels.add("ai-guide"); labels.add("ai-generated"); }
    if (annotation.quickAsk || annotation.review) labels.add("ai-generated");
    if (annotation.userEditedAt) labels.add("user-edited");
    if (!annotation.aiGuide && (annotation.note?.trim() || (!annotation.quickAsk && (annotation.kind === "text" || annotation.kind === "note") && annotation.text.trim()))) labels.add("personal");
    if (!annotation.note?.trim() && !annotation.quickAsk && !annotation.aiGuide) labels.add("excerpt");
  }
  // Thin-reading annotations are user-written comments, not the generated document.
  if (item.target.kind === "artifact-annotation") labels.add("personal");
  return [...labels];
}
export function resolvedNoteLabels(item: NotesItem, overrides: NoteLabelOverrides = {}): NoteLabel[] {
  const inferred = new Set(inferredNoteLabels(item));
  return noteLabelEntries.map(([id]) => id).filter((id) => overrides[id] ?? inferred.has(id));
}
export function isAiOnlyNote(labels: readonly NoteLabel[]): boolean {
  return (labels.includes("ai-generated") || labels.includes("ai-guide")) &&
    !labels.includes("user-edited") && !labels.includes("personal");
}
