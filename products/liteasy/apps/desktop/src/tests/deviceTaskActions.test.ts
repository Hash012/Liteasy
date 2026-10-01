import { webcrypto } from "node:crypto";
import { expect, test, vi } from "vitest";
import { prepareDeviceTask, type DeviceTaskActions } from "../app/controllers/deviceTaskActions";
import type { DeviceTask } from "../app/features/device-control/deviceControl.types";
import type { LocalLibrarySnapshot } from "../app/features/library/localLibrary.types";
import type { SettingsState } from "../app/features/settings/settings.types";

const mocks = vi.hoisted(() => ({ extract: vi.fn(), generate: vi.fn() }));
vi.mock("../app/features/import/pdfTextExtractor", () => ({ extractPdfPages: mocks.extract }));
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: mocks.generate }) }));
test("desktop validates actual PDF bytes, bounds model input and returns actual provider output", async () => {
  vi.stubGlobal("crypto", webcrypto);
  try {
    const bytes = new TextEncoder().encode("%PDF-1.7\noriginal");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const task: DeviceTask = { taskId: "task", operationId: "op", status: "leased", kind: "summarize-document", document: { documentId: "paper", contentHash: hash, title: "Paper" } };
    const snapshot: LocalLibrarySnapshot = { rootPath: "/library", libraryId: "lib", revision: 1, folders: [], trashEntries: [], entries: [{ id: "paper", contentHash: hash, path: "/library/paper.pdf", relativePath: "paper.pdf", title: "Paper" }] };
    const actions: DeviceTaskActions = { current: () => true, getPapers: () => [], getSettings: () => ({} as SettingsState), getTransport: () => undefined, openPaper: vi.fn(), refreshLibrary: vi.fn() };
    // TextEncoder creates bytes in the same realm as Node's WebCrypto; jsdom's
    // ArrayBuffer otherwise fails before the actual hash-mismatch assertion.
    expect(await prepareDeviceTask(task, actions, { load: async () => snapshot, read: async () => new TextEncoder().encode("invalid PDF bytes") })).toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
    const run = await prepareDeviceTask(task, actions, { load: async () => snapshot, read: async () => bytes });
    mocks.extract.mockResolvedValue([{ page: 1, text: "原文".repeat(20_000) }]); mocks.generate.mockResolvedValue({ answer: "来自模型的摘要 [第 1 页]" });
    const result = await run!(new AbortController().signal);
    expect(result.text).toBe("来自模型的摘要 [第 1 页]"); expect(result.message).toContain("前 24000 个字符");
    const input = mocks.generate.mock.calls[0][0]; expect(input.requireLive).toBe(true); expect(input.prompt).toContain("[第 1 页]"); expect(input.prompt.length).toBeLessThan(25_000);
    mocks.generate.mockRejectedValue(new Error("Provider unavailable"));
    await expect(run!(new AbortController().signal)).rejects.toThrow("Provider unavailable");
  } finally { vi.unstubAllGlobals(); }
});
