export type DiagnosticStage = "choose_file" | "read_file" | "open_reader";
export type DiagnosticOutcome = "succeeded" | "cancelled" | "failed";
export type DiagnosticFormat = "pdf" | "epub";
export type DiagnosticErrorCode = "choose_failed" | "read_failed" | "reader_failed";
export type DiagnosticRecord = Readonly<{
  sequence: number;
  stage: DiagnosticStage;
  outcome: DiagnosticOutcome;
  durationMs: number;
  format?: DiagnosticFormat;
  errorCode?: DiagnosticErrorCode;
}>;
type Snapshot = Readonly<{
  enabled: boolean;
  generation: number;
  records: readonly DiagnosticRecord[];
  droppedRecords: number;
}>;
const errorCodes: Record<DiagnosticStage, DiagnosticErrorCode> = {
  choose_file: "choose_failed", read_file: "read_failed", open_reader: "reader_failed",
};
export const diagnosticRecordLimit = 100;

/** Memory only. No error text, source identifiers, arguments or results are recorded. */
export function createLocalDiagnostics(now: () => number = () => performance.now()) {
  let snapshot: Snapshot = Object.freeze({ enabled: false, generation: 0, records: Object.freeze([]), droppedRecords: 0 });
  let sequence = 0;
  const listeners = new Set<() => void>();
  function update(next: Snapshot) {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }
  function reset() {
    sequence = 0;
    update({ enabled: false, generation: snapshot.generation + 1, records: Object.freeze([]), droppedRecords: 0 });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset,
    setEnabled(enabled: boolean) {
      if (enabled === snapshot.enabled) return;
      sequence = enabled ? 0 : sequence;
      update({
        enabled, generation: snapshot.generation + 1,
        records: enabled ? Object.freeze([]) : snapshot.records,
        droppedRecords: enabled ? 0 : snapshot.droppedRecords,
      });
    },
    async measure<T>(stage: DiagnosticStage, operation: () => Promise<T>, options: {
      format?: DiagnosticFormat;
      isCurrent?: () => boolean;
    } = {}): Promise<T> {
      // Opt-out does not even read the clock. Enabling during an operation does not capture it.
      if (!snapshot.enabled || !Object.prototype.hasOwnProperty.call(errorCodes, stage) || options.isCurrent?.() === false) return operation();
      const generation = snapshot.generation;
      const started = now();
      function record(outcome: DiagnosticOutcome) {
        if (!snapshot.enabled || snapshot.generation !== generation || options.isCurrent?.() === false) return;
        const elapsed = now() - started;
        const entry: DiagnosticRecord = Object.freeze({
          sequence: ++sequence, stage, outcome,
          durationMs: Number.isFinite(elapsed) ? Math.min(3_600_000, Math.max(0, Math.round(elapsed))) : 0,
          ...(options.format === "pdf" || options.format === "epub" ? { format: options.format } : {}),
          ...(outcome === "failed" ? { errorCode: errorCodes[stage] } : {}),
        });
        const records = [...snapshot.records, entry];
        const dropped = Math.max(0, records.length - diagnosticRecordLimit);
        update({ ...snapshot, records: Object.freeze(records.slice(-diagnosticRecordLimit)), droppedRecords: snapshot.droppedRecords + dropped });
      }
      try {
        const result = await operation();
        record(stage === "choose_file" && result === null ? "cancelled" : "succeeded");
        return result;
      } catch (error) {
        // Never stringify or inspect the exception: it can contain user text or credentials.
        record("failed");
        throw error;
      }
    },
  };
}

export const localDiagnostics = createLocalDiagnostics();
