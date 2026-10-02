import { expect, test, vi } from "vitest";
import { createLocalDiagnostics, diagnosticRecordLimit, type DiagnosticRecord } from "../app/features/local-diagnostics/localDiagnostics";
import { diagnosticEnvironment, serializeDiagnosticPackage } from "../app/features/local-diagnostics/diagnosticPackage";
import fixture from "../../../../../../development/test-data/client-diagnostics/original-open.json";

test("collection is memory-only and opt-out does not inspect result, error or clock", async () => {
  const clock = vi.fn(() => 50);
  const collector = createLocalDiagnostics(clock);
  const privateResult = { body: fixture.errorText };
  expect(await collector.measure("read_file", async () => privateResult)).toBe(privateResult);
  const error = Object.defineProperty({}, "message", { get() { throw new Error("Must never inspect error text"); } });
  await expect(collector.measure("read_file", async () => { throw error; })).rejects.toBe(error);
  expect(collector.getSnapshot()).toMatchObject({ enabled: false, records: [] });
  expect(clock).not.toHaveBeenCalled();
  collector.setEnabled(true);
  await expect(collector.measure("read_file", async () => { throw error; }, { format: "pdf" })).rejects.toBe(error);
  expect(collector.getSnapshot().records[0]).toEqual({ sequence: 1, stage: "read_file", outcome: "failed", durationMs: 0, format: "pdf", errorCode: "read_failed" });
  expect(createLocalDiagnostics().getSnapshot().records).toEqual([]);
});

test("opt-out, new session and reset invalidate late success and failure", async () => {
  const collector = createLocalDiagnostics();
  collector.setEnabled(true);
  let finish!: () => void;
  const pending = collector.measure("open_reader", () => new Promise<void>((resolve) => { finish = resolve; }));
  collector.setEnabled(false);
  collector.setEnabled(true);
  finish();
  await pending;
  expect(collector.getSnapshot().records).toEqual([]);
  let fail!: (error: unknown) => void;
  const failing = collector.measure("read_file", () => new Promise<void>((_, reject) => { fail = reject; }));
  collector.reset();
  collector.setEnabled(true);
  fail(fixture.errorText);
  await expect(failing).rejects.toBe(fixture.errorText);
  expect(collector.getSnapshot().records).toEqual([]);
  await collector.measure("read_file", async () => undefined, { isCurrent: () => false });
  expect(collector.getSnapshot().records).toEqual([]);
});

test("bounded frozen records expose dropped count and clamp invalid timing", async () => {
  const collector = createLocalDiagnostics(() => Infinity);
  collector.setEnabled(true);
  for (let index = 0; index < diagnosticRecordLimit + 3; index += 1) await collector.measure("read_file", async () => undefined);
  const snapshot = collector.getSnapshot();
  expect(snapshot.records).toHaveLength(100);
  expect(snapshot.records[0]).toMatchObject({ sequence: 4, durationMs: 0 });
  expect(snapshot.droppedRecords).toBe(3);
  expect(Object.isFrozen(snapshot.records)).toBe(true);
  expect(Object.isFrozen(snapshot.records[0])).toBe(true);
  collector.setEnabled(false);
  expect(collector.getSnapshot().records).toEqual(snapshot.records);
  collector.reset();
  expect(collector.getSnapshot()).toMatchObject({ enabled: false, records: [], droppedRecords: 0 });
});

test("export projects enums and numeric fields without serializing arbitrary content", () => {
  const record = {
    sequence: 1, stage: "read_file", outcome: "failed", durationMs: -10, format: fixture.errorText,
    errorCode: fixture.errorText, body: fixture.errorText, path: fixture.file.path,
    toJSON() { throw new Error("Do not serialize arbitrary objects"); },
  } as unknown as DiagnosticRecord;
  const environment = diagnosticEnvironment(`Windows Win64 Chrome/134.0.6998.88 ${fixture.errorText}`, true);
  const json = serializeDiagnosticPackage([record], 0, { ...environment, appVersion: fixture.errorText });
  for (const forbidden of fixture.forbiddenExportStrings) expect(json).not.toContain(forbidden);
  expect(JSON.parse(json)).toMatchObject({
    environment: { appVersion: "unknown", runtime: "tauri", os: "windows", arch: "x86_64", webviewEngine: "chromium", webviewEngineVersion: "134.0.6998.88" },
    records: [{ stage: "read_file", outcome: "failed", durationMs: 0, errorCode: "read_failed" }],
  });
  expect(JSON.parse(serializeDiagnosticPackage([record], 0))).not.toHaveProperty("environment");
  expect(diagnosticEnvironment(fixture.errorText, false)).toMatchObject({ os: "unknown", arch: "unknown", webviewEngine: "unknown", webviewEngineVersion: "unknown" });
  expect(diagnosticEnvironment("Macintosh AppleWebKit/605.1.15", true)).toMatchObject({ os: "macos", arch: "unknown", webviewEngine: "webkit", webviewEngineVersion: "605.1.15" });
});
