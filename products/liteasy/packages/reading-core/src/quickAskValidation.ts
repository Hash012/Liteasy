import type { QuickAskContextSnapshot, QuickAskGenerationReceipt } from "./quickAsk";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nonempty = (v: unknown) => text(v) && v.length > 0;
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const positive = (v: unknown) => integer(v) && (v as number) > 0;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const hash = (v: unknown) => text(v) && /^(?:sha256:)?[a-f0-9]{64}$/i.test(v);
const list = (v: unknown, check: (x: unknown) => boolean) => Array.isArray(v) && v.length <= 10000 && v.every(check);
const role = (v: unknown) => ["selection", "page", "abstract", "introduction"].includes(v as string);
const range = (v: unknown) => object(v) && integer(v.start) && integer(v.end) && (v.end as number) >= (v.start as number) && v.unit === "utf16";
const part = (v: unknown) => object(v) && Array.isArray(v.roles) && v.roles.length > 0 && v.roles.every(role) &&
  ["available", "partial", "not_found", "not_ready", "unreadable", "omitted_budget", "unsupported"].includes(v.status as string) &&
  text(v.text) && typeof v.complete === "boolean" && text(v.extraction) && (v.reason === undefined || text(v.reason)) &&
  list(v.spans, (s) => object(s) && positive(s.page) && ["range", "page", "unknown"].includes(s.precision as string) &&
    (s.startUtf16 === undefined || integer(s.startUtf16)) && (s.endUtf16 === undefined || integer(s.endUtf16)) &&
    (s.precision !== "range" || (integer(s.startUtf16) && integer(s.endUtf16) && (s.endUtf16 as number) >= (s.startUtf16 as number))));

export function isQuickAskContextSnapshot(v: unknown): v is QuickAskContextSnapshot {
  if (!object(v) || v.schema !== "liteasy.quick-ask-context/v1" || !nonempty(v.snapshotId) || !object(v.source) ||
    ![v.source.scopeId, v.source.paperId, v.source.documentRevision, v.source.extractorRevision, v.selectionId].every(nonempty) ||
    !Array.isArray(v.sourcePages) || !v.sourcePages.length || !v.sourcePages.every(positive) ||
    !list(v.available, part) || !list(v.delivered, part) ||
    !list(v.omitted, (x) => object(x) && role(x.role) && text(x.reason)) || !hash(v.inputHash) ||
    !integer(v.inputTokenEstimate) || !positive(v.inputBudget) || !object(v.ledger)) return false;
  const { reads, deliveries } = v.ledger;
  return list(reads, (r) => object(r) && [r.id, r.path, r.scopeId, r.representationId].every(nonempty) &&
      (r.revision === undefined || text(r.revision)) && list(r.ranges, range) && hash(r.fetchedHash) && date(r.fetchedAt)) &&
    list(deliveries, (d) => object(d) && nonempty(d.id) && nonempty(d.requestId) && ["model", "display", "verifier"].includes(d.audience as string) &&
      list(d.readIds, nonempty) && hash(d.payloadHash) && date(d.at) && list(d.ranges, (r) => object(r) && nonempty(r.readId) && list(r.ranges, range)));
}
export function isQuickAskGenerationReceipt(v: unknown): v is QuickAskGenerationReceipt {
  return object(v) && v.schema === "liteasy.quick-ask-receipt/v1" && [v.requestId, v.attemptId, v.providerId, v.modelId].every(nonempty) &&
    integer(v.scopeGeneration) && ["completed", "failed", "incomplete", "aborted"].includes(v.terminal as string) &&
    object(v.presetSnapshot) && [v.presetSnapshot.id, v.presetSnapshot.revision, v.presetSnapshot.instruction].every(nonempty) &&
    nonempty(v.effectiveInstruction) && isQuickAskContextSnapshot(v.context) && date(v.createdAt) &&
    v.modelAttempts === 1 && typeof v.contextPrepareMs === "number" && Number.isFinite(v.contextPrepareMs) && v.contextPrepareMs >= 0 &&
    (v.firstTokenMs === undefined || (typeof v.firstTokenMs === "number" && Number.isFinite(v.firstTokenMs) && v.firstTokenMs >= 0)) &&
    (v.saved === undefined || (object(v.saved) && nonempty(v.saved.annotationId) && nonempty(v.saved.revision) && date(v.saved.committedAt)));
}
