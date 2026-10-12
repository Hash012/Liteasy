import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useArtifactExportController } from "../app/controllers/useArtifactExportController";
import type { ArtifactExportClient } from "../app/features/artifacts/artifactExportClient";
import type { ArtifactExportRecord } from "../app/features/artifacts/artifactExport.types";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";

const tab: ArtifactTab = {
  answer: "薄读内容",
  artifactId: "artifact-thin-reading",
  title: "薄读",
  thinReadingDocument: createThinReadingDocument(createThinReadingFixture()),
  type: "thin_reading"
};

const availableRecord: ArtifactExportRecord = {
  artifactId: tab.artifactId,
  exportedAt: "2026-08-09T03:00:00.000Z",
  fileName: "薄读.md",
  format: "markdown",
  id: "export-1",
  location: "desktop",
  path: "/tmp/薄读.md",
  status: "available",
  title: tab.title
};

function client(overrides: Partial<ArtifactExportClient> = {}): ArtifactExportClient {
  return {
    export: vi.fn(async () => ({ record: availableRecord, status: "saved" as const })),
    list: vi.fn(async () => []),
    open: vi.fn(async () => availableRecord),
    remove: vi.fn(async () => undefined),
    reveal: vi.fn(async () => availableRecord),
    ...overrides
  };
}

describe("useArtifactExportController", () => {
  test("a prepared A snapshot cannot publish after A -> logout -> A with a new session", async () => {
    const exportClient = client();
    const { result, rerender } = renderHook(({ generation }) => useArtifactExportController({ client: exportClient, scopeId: "A", sessionGeneration: generation }), { initialProps: { generation: "session-1" } });
    let document: Awaited<ReturnType<typeof result.current.actions.compileArtifact>>;
    await act(async () => { document = await result.current.actions.compileArtifact(tab); });
    rerender({ generation: "session-3" });
    await expect(result.current.actions.publish({ artifactId: tab.artifactId, title: tab.title, format: "markdown", fileName: "report.md", content: "body", contentEncoding: "utf8", scopeId: document!.scopeId, sessionGeneration: document!.sessionGeneration })).rejects.toThrow("账号已切换");
    expect(exportClient.export).not.toHaveBeenCalled();
  });
  test("reports loading until the initial device export history resolves", async () => {
    let resolveList: (records: ArtifactExportRecord[]) => void = () => undefined;
    const listPromise = new Promise<ArtifactExportRecord[]>((resolve) => {
      resolveList = resolve;
    });
    const exportClient = client({ list: vi.fn(() => listPromise) });
    const { result } = renderHook(() => useArtifactExportController({ client: exportClient }));

    expect(result.current.model).toEqual({
      error: undefined,
      records: [],
      status: "loading"
    });

    await act(async () => {
      resolveList([availableRecord]);
      await listPromise;
    });

    expect(result.current.model).toEqual({
      error: undefined,
      records: [availableRecord],
      status: "ready"
    });
  });

  test("refreshes history after a successful export", async () => {
    const exportClient = client({
      list: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([availableRecord])
    });
    const { result } = renderHook(() => useArtifactExportController({ client: exportClient }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      const outcome = await result.current.actions.exportArtifact(tab, "markdown");
      expect(outcome.status).toBe("saved");
    });

    expect(exportClient.export).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: tab.artifactId,
      fileName: "薄读.md"
    }));
    expect(exportClient.list).toHaveBeenCalledTimes(2);
    expect(result.current.model.records[0].fileName).toBe("薄读.md");
  });

  test("leaves records and errors unchanged when export is cancelled", async () => {
    const exportClient = client({
      export: vi.fn(async () => ({ status: "cancelled" as const })),
      list: vi.fn(async () => [availableRecord])
    });
    const { result } = renderHook(() => useArtifactExportController({ client: exportClient }));
    await act(async () => {
      await Promise.resolve();
    });
    const before = result.current.model;

    await act(async () => {
      await result.current.actions.exportArtifact(tab, "markdown");
    });

    expect(result.current.model).toEqual(before);
    expect(exportClient.list).toHaveBeenCalledTimes(1);
  });

  test("refreshes missing-file status while preserving the open error", async () => {
    const missingRecord: ArtifactExportRecord = { ...availableRecord, status: "missing" };
    const exportClient = client({
      list: vi.fn()
        .mockResolvedValueOnce([availableRecord])
        .mockResolvedValueOnce([missingRecord]),
      open: vi.fn(async () => {
        throw new Error("导出文件已不存在。");
      })
    });
    const { result } = renderHook(() => useArtifactExportController({ client: exportClient }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.actions.openExport(availableRecord.id);
    });

    expect(result.current.model.error).toBe("导出文件已不存在。");
    expect(result.current.model.records).toEqual([missingRecord]);
    expect(result.current.model.status).toBe("ready");
    expect(exportClient.list).toHaveBeenCalledTimes(2);
  });

  test("removes a history record without deleting or opening the file", async () => {
    const exportClient = client({
      list: vi.fn()
        .mockResolvedValueOnce([availableRecord])
        .mockResolvedValueOnce([])
    });
    const { result } = renderHook(() => useArtifactExportController({ client: exportClient }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.actions.removeExport(availableRecord.id);
    });

    expect(exportClient.remove).toHaveBeenCalledWith(availableRecord.id);
    expect(exportClient.open).not.toHaveBeenCalled();
    expect(result.current.model.records).toEqual([]);
  });
});
