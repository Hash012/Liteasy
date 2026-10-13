import { describe, expect, test, vi } from "vitest";
import { sha256 } from "../app/features/document-export/documentExport.types";
import { compileDocument } from "../app/features/document-export/documentCompiler";
import { createExportJob, prepareExportJob, publishExportJob, cancelExportJob, restoreExportJob } from "../app/features/document-export/documentExportJob";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe("frozen document jobs", () => {
  test("publishes the exact preview payload and rechecks authorization without recompiling", async () => {
    const document = await compileDocument({ title: "Frozen", markdown: "PREVIEW_BYTES" });
    document.assertAuthorized = vi.fn(async () => undefined);
    const compile = vi.fn(async () => document), job = createExportJob("markdown");
    await prepareExportJob(job, compile);
    const shown = job.payload;
    expect(atob(shown!.content)).toContain("PREVIEW_BYTES");
    expect(shown!.receipt?.sha256).toBe(await sha256(Uint8Array.from(atob(shown!.content), char => char.charCodeAt(0))));
    const publish = vi.fn(async (_payload: import("../app/features/artifacts/artifactExport.types").ArtifactExportPayload) => ({ status: "cancelled" as const }));
    await publishExportJob(job, publish);
    expect(publish.mock.calls[0][0]).toBe(shown); expect(compile).toHaveBeenCalledTimes(1); expect(document.assertAuthorized).toHaveBeenCalledTimes(1);
    document.assertAuthorized = vi.fn(async () => { throw new Error("scope changed"); });
    await publishExportJob(job, publish); expect(publish).toHaveBeenCalledTimes(1); expect(job.error).toBe("scope changed");
  });
  test("detached jobs finish independently; explicit cancellation blocks their late payload", async () => {
    const document = await compileDocument({ title: "Late", markdown: "LATE_BYTES" });
    const pending = deferred<typeof document>(), retained = restoreExportJob(`scope-a:${crypto.randomUUID()}`, "markdown");
    const preparation = prepareExportJob(retained, () => pending.promise);
    const a = createExportJob("markdown"), cancelled = deferred<typeof document>();
    const cancelledPreparation = prepareExportJob(a, () => cancelled.promise); cancelExportJob(a);
    pending.resolve(document); cancelled.resolve(document); await Promise.all([preparation, cancelledPreparation]);
    expect(retained.status).toBe("ready"); expect(atob(retained.payload!.content)).toContain("LATE_BYTES"); expect(a.status).toBe("cancelled"); expect(a.payload).toBeUndefined();
    const publish = vi.fn(); await publishExportJob(a, publish); expect(publish).not.toHaveBeenCalled();
  });
  test("scope/source identities cannot restore another job's accepted diagnostics", () => {
    const suffix = crypto.randomUUID(), a = restoreExportJob(`scope-a:${suffix}`, "markdown"); a.accepted = true;
    expect(restoreExportJob(`scope-a:${suffix}`, "markdown")).toBe(a);
    const b = restoreExportJob(`scope-b:${suffix}`, "markdown"); expect(b).not.toBe(a); expect(b.accepted).toBe(false);
  });
});
