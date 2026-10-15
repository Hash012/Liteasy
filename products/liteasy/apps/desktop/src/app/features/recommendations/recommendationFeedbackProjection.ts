/** Durable preferences are independent of the provider's candidate cache. */
export type FeedbackAction = "read" | "not_relevant" | "too_basic" | "too_advanced" | "snoozed" | "saved" | "legacy_suppression" | "undo";
export type FeedbackCommand = { commandId: string; issuedAt: number; paperId: string; facetId?: string; action: FeedbackAction; snapshotId?: string; targetEventId?: string };
export type FeedbackReceipt = { commandId: string; eventId: string; committedRevision: number; issuedAt: number; action: FeedbackAction; paperId: string; facetId?: string };
export type FeedbackEvent = FeedbackCommand & { eventId: string; sequence: number; at: number; undone?: boolean };
export type FeedbackProjection = { paperId: string; facetId?: string; dimension: string; action: FeedbackAction; at: number; eventId: string };
export type FeedbackState = { schema: 3; revision: number; events: FeedbackEvent[]; base: FeedbackProjection[]; receipts: FeedbackReceipt[]; replayBefore: number; migrations: string[] };
export const emptyFeedback = (): FeedbackState => ({ schema: 3, revision: 0, events: [], base: [], receipts: [], replayBefore: 0, migrations: [] });
const dimension = (action: FeedbackAction) => action === "too_basic" || action === "too_advanced" ? "difficulty" : action;
const globalAction = (action: FeedbackAction) => ["read", "saved", "legacy_suppression"].includes(action);
function fold(base: FeedbackProjection[], events: FeedbackEvent[]) {
  const key = (row: FeedbackProjection) => JSON.stringify([row.paperId, row.facetId, row.dimension]);
  const rows = new Map(base.map(row => [key(row), row]));
  for (const event of events) {
    if (event.undone || event.action === "undo") continue;
    const row = { paperId: event.paperId, facetId: globalAction(event.action) ? undefined : event.facetId ?? "legacy-unscoped", dimension: dimension(event.action), action: event.action, at: event.at, eventId: event.eventId };
    rows.set(key(row), row);
  }
  return [...rows.values()];
}
export const projectFeedback = (value: FeedbackState, now: number) => fold(value.base, value.events).filter(row => row.action !== "snoozed" || row.at + 7 * 86_400_000 > now);
export function commitFeedback(value: FeedbackState, command: FeedbackCommand, now: number): FeedbackReceipt {
  const previous = value.receipts.find(row => row.commandId === command.commandId);
  if (previous) {
    if (previous.paperId !== command.paperId || previous.action !== command.action || previous.facetId !== command.facetId) throw new Error("这次重试与原反馈不一致，请重新操作。");
    return previous;
  }
  if (!command.commandId || !command.paperId || !Number.isFinite(command.issuedAt)) throw new Error("反馈内容不完整，请重新操作。");
  if (command.issuedAt <= value.replayBefore) throw new Error("这次操作的重试期限已过，请检查当前状态后重新操作。");
  if (command.action === "undo") {
    const target = value.events.find(row => row.eventId === command.targetEventId && row.paperId === command.paperId && row.action !== "undo");
    if (!target) throw new Error("这次反馈已超出可撤销范围，当前其他反馈保持不变。");
    target.undone = true;
  }
  const event: FeedbackEvent = { ...command, eventId: command.commandId, sequence: ++value.revision, at: now };
  value.events.push(event);
  const receipt: FeedbackReceipt = { commandId: command.commandId, eventId: event.eventId, committedRevision: value.revision, issuedAt: command.issuedAt, action: command.action, paperId: command.paperId, facetId: command.facetId };
  value.receipts.push(receipt);
  if (value.events.length > 512) value.base = fold(value.base, value.events.splice(0, value.events.length - 512));
  if (value.receipts.length > 2048) {
    const removed = value.receipts.splice(0, value.receipts.length - 2048);
    value.replayBefore = Math.max(value.replayBefore, ...removed.map(row => row.issuedAt));
  }
  return receipt;
}
export const feedbackFacet = (item: { facetId?: string }) => item.facetId ?? "legacy-unscoped";
export function feedbackForPaper(rows: FeedbackProjection[], item: { canonicalId?: string; id: string; facetId?: string }) {
  return rows.filter(row => row.paperId === (item.canonicalId ?? item.id) && (!row.facetId || row.facetId === feedbackFacet(item)));
}
export function feedbackHides(rows: FeedbackProjection[], item: { canonicalId?: string; id: string; facetId?: string }) {
  return feedbackForPaper(rows, item).some(row => ["read", "snoozed", "not_relevant", "legacy_suppression"].includes(row.action));
}

export type FeedbackRequest = { commandId: string; issuedAt: number; targetEventId?: string };
export type RecommendationFeedbackHandler = (item: import("./recommendation.types").RecommendationItem, action: import("./recommendationCoordinator").RecommendationFeedbackMeaning, command?: FeedbackRequest) => Promise<FeedbackReceipt>;
