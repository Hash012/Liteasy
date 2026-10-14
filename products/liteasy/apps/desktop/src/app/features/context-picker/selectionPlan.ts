import type { AssistantContextToken } from "../assistant/assistant.types";
import { contextReferenceIdentity, mergeContextSelection } from "../assistant/contextSelectionManifest";

/** Only identities and version watermarks are persisted, never bodies or image bytes. */
export type PlannedMember = { id: string; path?: string; revision?: string; watermark?: string; completeText?: boolean; representation?: "text" | "image" | "file" | "reference" };
export type SelectionIntent = { id: string; catalogRevision: string; policy: "items" | "originals" | "related" | "filtered"; members: PlannedMember[]; exclusions: string[] };
export type SelectionDraft = { schemaVersion: 1; intents: SelectionIntent[]; errors: Record<string, string>; receipts: Record<string, "added" | "alreadyPresent"> };
export const emptySelectionDraft = (): SelectionDraft => ({ schemaVersion: 1, intents: [], errors: {}, receipts: {} });
export function selectionMembers(draft: SelectionDraft): PlannedMember[] {
  const members = new Map<string, PlannedMember>();
  for (const intent of draft.intents) {
    const excluded = new Set(intent.exclusions);
    for (const member of intent.members) if (!excluded.has(member.id)) members.set(member.id, member);
  }
  return [...members.values()];
}
export function addSelectionIntent(draft: SelectionDraft, intent: SelectionIntent): SelectionDraft {
  return { ...draft, intents: [...draft.intents.filter(item => item.id !== intent.id), intent] };
}
export function excludeSelectionMembers(draft: SelectionDraft, ids: readonly string[]): SelectionDraft {
  const removed = new Set(ids);
  return { ...draft, intents: draft.intents.map(intent => ({ ...intent, exclusions: [...new Set([...intent.exclusions, ...intent.members.filter(member => removed.has(member.id)).map(member => member.id)])] })) };
}
export function undoSelectionIntent(draft: SelectionDraft, id: string): SelectionDraft {
  return { ...draft, intents: draft.intents.filter(intent => intent.id !== id) };
}
export function readSelectionDraft(value: unknown): SelectionDraft {
  const raw = value as SelectionDraft | undefined;
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.intents) || !raw.errors || !raw.receipts) return emptySelectionDraft();
  if (typeof raw.errors !== "object" || Object.values(raw.errors).some(value => typeof value !== "string") || typeof raw.receipts !== "object") return emptySelectionDraft();
  if (raw.intents.some(intent => !intent || typeof intent.id !== "string" || !Array.isArray(intent.members) || !Array.isArray(intent.exclusions)
    || intent.exclusions.some(id => typeof id !== "string")
    || intent.members.some(member => !member || typeof member.id !== "string" || [member.path, member.revision, member.watermark].some(value => value !== undefined && typeof value !== "string")))) return emptySelectionDraft();
  return raw;
}
export type SelectionReceipt = { id: string; status: "added" | "alreadyPresent" | "failed" | "blocked"; message?: string };
export async function resolveSelectionBatch(input: {
  members: PlannedMember[]; existing: readonly AssistantContextToken[]; signal: AbortSignal;
  active(): boolean; resolve(member: PlannedMember): Promise<AssistantContextToken>;
  commit(token: AssistantContextToken): void | boolean | Promise<void | boolean>;
  onReceipt(receipt: SelectionReceipt): void;
}) {
  const accepted = [...input.existing];
  const check = () => { input.signal.throwIfAborted(); if (!input.active()) throw new Error("目标草稿已切换，请重新添加。"); };
  for (const member of input.members) {
    check();
    try {
      const token = await input.resolve(member); check();
      const merged = mergeContextSelection(accepted, token);
      if (!merged) { input.onReceipt({ id: member.id, status: "alreadyPresent" }); continue; }
      const acknowledged = await input.commit(merged); check();
      if (acknowledged === false) throw new Error("目标草稿未接收此项，请重试。");
      accepted.push(merged); input.onReceipt({ id: member.id, status: "added" });
    } catch (error) {
      check(); input.onReceipt({ id: member.id, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
}
/** Text range coverage is explicit; pixels and captions are separate representations. */
export type ContextRange = { source: string; revision: string; representation: "text" | "image"; start: number; end: number };
export function subtractContextRanges(whole: ContextRange, excluded: ContextRange[]): ContextRange[] {
  if (!Number.isSafeInteger(whole.start) || !Number.isSafeInteger(whole.end) || whole.end <= whole.start) throw new Error("没有可核验的全文区间，不能排除片段。");
  let ranges = [whole];
  for (const cut of excluded.filter(value => value.source === whole.source && value.revision === whole.revision && value.representation === whole.representation))
    ranges = ranges.flatMap(range => cut.end <= range.start || cut.start >= range.end ? [range] : [
      ...(cut.start > range.start ? [{ ...range, end: cut.start }] : []), ...(cut.end < range.end ? [{ ...range, start: cut.end }] : [])]);
  return ranges;
}
export function attachedReferenceKeys(tokens: readonly AssistantContextToken[]) {
  return new Set(tokens.flatMap(token => token.contextRefs?.map(contextReferenceIdentity) ?? [`token:${token.id}`]));
}
