/** Persistable, credential-free provenance for the restricted quick-ask path. */
export type QuickAskRole = "selection" | "page" | "abstract" | "introduction";
export type QuickAskAvailability = "available" | "partial" | "not_found" | "not_ready" | "unreadable" | "omitted_budget" | "unsupported";
export type QuickAskSource = { scopeId: string; paperId: string; documentRevision: string; extractorRevision: string };
export type QuickAskSpan = { page: number; startUtf16?: number; endUtf16?: number; precision: "range" | "page" | "unknown" };
export type QuickAskContextPart = {
  roles: QuickAskRole[]; status: QuickAskAvailability; text: string; spans: QuickAskSpan[];
  complete: boolean; extraction: string; reason?: string;
};
export type QuickAskContextSnapshot = {
  schema: "liteasy.quick-ask-context/v1"; snapshotId: string; source: QuickAskSource;
  selectionId: string; sourcePages: number[]; available: QuickAskContextPart[];
  delivered: QuickAskContextPart[]; omitted: { role: QuickAskRole; reason: string }[];
  inputHash: string; inputTokenEstimate: number; inputBudget: number;
  /** Compatible with the shared content-read ledger. Text remains in the pinned snapshot. */
  ledger: {
    reads: { id: string; path: string; revision?: string; scopeId: string; representationId: string;
      ranges: { start: number; end: number; unit: "utf16" }[]; fetchedHash: string; fetchedAt: string }[];
    deliveries: { id: string; requestId: string; audience: "model" | "display" | "verifier";
      readIds: string[]; payloadHash: string; ranges: { readId: string; ranges: { start: number; end: number; unit: "utf16" }[] }[]; at: string }[];
  };
};
export type QuickAskPresetSnapshot = { id: string; revision: string; instruction: string };
export type QuickAskGenerationReceipt = {
  schema: "liteasy.quick-ask-receipt/v1"; requestId: string; attemptId: string; scopeGeneration: number;
  terminal: "completed" | "failed" | "incomplete" | "aborted";
  providerId: string; modelId: string; presetSnapshot: QuickAskPresetSnapshot;
  effectiveInstruction: string; context: QuickAskContextSnapshot; createdAt: string;
  modelAttempts: number; contextPrepareMs: number; firstTokenMs?: number;
  /** Canonical answer is the existing annotation.quickAsk.answer, never duplicated here. */
  saved?: { annotationId: string; revision: string; committedAt: string };
};
