import { expect, test, vi } from "vitest";
import { createLocalArchiveService } from "../app/features/local-archive/localArchiveService";

test("native archive calls bind scope and use opaque plan and receipt IDs without caller file paths", async () => {
  const invoke = vi.fn(async () => undefined);
  const api = createLocalArchiveService("local", () => "local", invoke);
  await api.prepareExport(["selected-paper"]); await api.commit("plan"); await api.openDocument("receipt", "document-0001");
  expect(invoke.mock.calls).toEqual([
    ["local_archive_prepare_export", { scope: "local", documentIds: ["selected-paper"] }],
    ["local_archive_commit", { scope: "local", planId: "plan" }],
    ["local_archive_open_restored", { scope: "local", receiptId: "receipt", documentId: "document-0001" }]
  ]);
});

test("a late native preview after account change is cancelled and never returned to another scope", async () => {
  let scope = "local"; let resolve!: (value: unknown) => void;
  const invoke = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(undefined);
  const api = createLocalArchiveService("local", () => scope, invoke);
  const pending = api.prepareRestore(); scope = "user:b"; resolve({ planId: "stale-plan" });
  await expect(pending).rejects.toThrow("账号已切换");
  expect(invoke).toHaveBeenLastCalledWith("local_archive_cancel", { scope: "local", planId: "stale-plan" });
});
