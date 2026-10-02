import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useOriginalFileOpenController } from "../app/controllers/useOriginalFileOpenController";
import { localDiagnostics } from "../app/features/local-diagnostics/localDiagnostics";
import { serializeDiagnosticPackage } from "../app/features/local-diagnostics/diagnosticPackage";
import type { OriginalFileDescriptor, OriginalFileService } from "../app/features/original-files/originalFileService";
import fixture from "../../../../../../development/test-data/client-diagnostics/original-open.json";

beforeEach(() => localDiagnostics.reset());
afterEach(() => localDiagnostics.reset());
const file = fixture.file as OriginalFileDescriptor;
function harness(options: { read?: OriginalFileService["read"]; cancel?: boolean; readerFails?: boolean } = {}) {
  let wake!: () => void;
  const service: OriginalFileService = {
    choose: vi.fn(async () => options.cancel ? null : file),
    read: vi.fn(options.read ?? (async () => new Uint8Array([1, 2]))),
    release: vi.fn(async () => undefined),
    drain: vi.fn(async () => ({ files: [] as OriginalFileDescriptor[], errors: [] })),
    subscribe: vi.fn(async (callback) => { wake = callback; return vi.fn(); }),
  };
  const onOpenPdf = vi.fn(async () => { if (options.readerFails) throw new Error(fixture.errorText); });
  const onError = vi.fn();
  const hook = renderHook(({ scopeId }) => useOriginalFileOpenController({
    scopeId, service, onOpenPdf, onOpenEpub: vi.fn(async () => undefined), onError,
  }), { initialProps: { scopeId: "local" } });
  return { hook, service, onOpenPdf, onError, wake: () => wake() };
}

test.each(fixture.cases)("synthetic original-file transport: $id exports only expected phase codes", async (scenario) => {
  const h = harness({
    cancel: scenario.id === "picker-cancel", readerFails: scenario.id === "reader-failure",
    read: scenario.id === "read-failure" ? async () => { throw new Error(fixture.errorText); } : undefined,
  });
  await waitFor(() => expect(h.service.drain).toHaveBeenCalledTimes(1));
  localDiagnostics.setEnabled(true);
  if (scenario.id === "queued-success") {
    vi.mocked(h.service.drain).mockResolvedValueOnce({ files: [file], errors: [] });
    act(() => h.wake());
    await waitFor(() => expect(h.onOpenPdf).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.hook.result.current.busy).toBe(false));
  } else await act(async () => { await h.hook.result.current.openFile(); });
  const records = localDiagnostics.getSnapshot().records;
  expect(records.map((record) => `${record.stage}:${record.outcome}`)).toEqual(scenario.outcomes);
  const json = serializeDiagnosticPackage(records, 0);
  for (const forbidden of fixture.forbiddenExportStrings) expect(json).not.toContain(forbidden);
  if (scenario.id.endsWith("failure")) {
    expect(h.onError).toHaveBeenCalledWith(fixture.errorText);
    expect(h.service.release).toHaveBeenCalledWith(file);
  }
});

test("real controller remains unobserved before opt-in", async () => {
  const h = harness();
  await waitFor(() => expect(h.service.drain).toHaveBeenCalledTimes(1));
  await act(async () => { await h.hook.result.current.openFile(); });
  expect(h.onOpenPdf).toHaveBeenCalledTimes(1);
  expect(localDiagnostics.getSnapshot().records).toEqual([]);
});

test("scope change clears and disables diagnostics before a late read resolves", async () => {
  let finish!: (bytes: Uint8Array) => void;
  const h = harness({ read: () => new Promise((resolve) => { finish = resolve; }) });
  await waitFor(() => expect(h.service.drain).toHaveBeenCalledTimes(1));
  localDiagnostics.setEnabled(true);
  let pending!: Promise<void>;
  act(() => { pending = h.hook.result.current.openFile(); });
  await waitFor(() => expect(h.service.read).toHaveBeenCalledTimes(1));
  expect(localDiagnostics.getSnapshot().records).toHaveLength(1);
  h.hook.rerender({ scopeId: "user:synthetic-next-account" });
  expect(localDiagnostics.getSnapshot()).toMatchObject({ enabled: false, records: [] });
  localDiagnostics.setEnabled(true);
  await act(async () => { finish(new Uint8Array([1])); await pending; });
  expect(localDiagnostics.getSnapshot().records).toEqual([]);
  expect(h.onOpenPdf).not.toHaveBeenCalled();
});

test("closing and re-enabling collection during a read excludes the rest of that open flow", async () => {
  let finish!: (bytes: Uint8Array) => void;
  const h = harness({ read: () => new Promise((resolve) => { finish = resolve; }) });
  await waitFor(() => expect(h.service.drain).toHaveBeenCalledTimes(1));
  localDiagnostics.setEnabled(true);
  let pending!: Promise<void>;
  act(() => { pending = h.hook.result.current.openFile(); });
  await waitFor(() => expect(h.service.read).toHaveBeenCalledTimes(1));
  localDiagnostics.setEnabled(false);
  localDiagnostics.setEnabled(true);
  await act(async () => { finish(new Uint8Array([1])); await pending; });
  expect(h.onOpenPdf).toHaveBeenCalledTimes(1);
  expect(localDiagnostics.getSnapshot().records).toEqual([]);
});
