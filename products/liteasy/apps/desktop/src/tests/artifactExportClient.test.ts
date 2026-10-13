import { beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactExportClient } from "../app/features/artifacts/artifactExportClient";
import type {
  ArtifactExportPayload,
  ArtifactExportRecord
} from "../app/features/artifacts/artifactExport.types";

const payload: ArtifactExportPayload = {
  artifactId: "artifact-thin-reading",
  content: "# 薄读",
  contentEncoding: "utf8",
  fileName: "薄读.md",
  format: "markdown",
  title: "薄读"
};

const desktopRecord: ArtifactExportRecord = {
  artifactId: payload.artifactId,
  exportedAt: "2026-08-09T02:00:00.000Z",
  fileName: payload.fileName,
  format: payload.format,
  id: "desktop-record-1",
  location: "desktop",
  path: "/tmp/薄读.md",
  status: "available",
  title: payload.title
};

describe("artifact export client", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("maps desktop export history operations to checked Tauri commands", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "export_artifact_document") {
        return { record: desktopRecord, status: "saved" };
      }
      if (command === "list_artifact_exports") return [desktopRecord];
      if (command === "remove_artifact_export") return undefined;
      return desktopRecord;
    });
    const client = createArtifactExportClient({ invoke });

    await expect(client.export(payload)).resolves.toEqual({
      record: desktopRecord,
      status: "saved"
    });
    await expect(client.list()).resolves.toEqual([desktopRecord]);
    await expect(client.open(desktopRecord.id)).resolves.toEqual(desktopRecord);
    await expect(client.reveal(desktopRecord.id)).resolves.toEqual(desktopRecord);
    await expect(client.remove(desktopRecord.id)).resolves.toBeUndefined();

    expect(invoke).toHaveBeenNthCalledWith(1, "export_artifact_document", { input: payload });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_artifact_exports");
    expect(invoke).toHaveBeenNthCalledWith(3, "open_artifact_export", {
      recordId: desktopRecord.id
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "reveal_artifact_export", {
      recordId: desktopRecord.id
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "remove_artifact_export", {
      recordId: desktopRecord.id
    });
  });

  test("downloads and stores browser-managed history without a fake path", async () => {
    const download = vi.fn();
    const client = createArtifactExportClient({
      createId: () => "browser-record-1",
      download,
      now: () => new Date("2026-08-09T03:00:00.000Z"),
      storage: window.localStorage
    });

    const outcome = await client.export(payload);

    expect(download).toHaveBeenCalledWith(payload);
    expect(outcome).toEqual({
      record: {
        artifactId: payload.artifactId,
        exportedAt: "2026-08-09T03:00:00.000Z",
        fileName: payload.fileName,
        format: payload.format,
        id: "browser-record-1",
        location: "browser",
        status: "browser_managed",
        title: payload.title
      },
      status: "download_started"
    });
    const [record] = await client.list();
    expect(record).not.toHaveProperty("path");
  });

  test("rejects host-only actions for browser downloads and removes history only", async () => {
    const download = vi.fn();
    const client = createArtifactExportClient({
      createId: () => "browser-record-1",
      download,
      storage: window.localStorage
    });
    const outcome = await client.export(payload);
    if (outcome.status !== "download_started") throw new Error("expected browser download handoff");

    await expect(client.open(outcome.record.id)).rejects.toThrow("该导出由浏览器管理");
    await expect(client.reveal(outcome.record.id)).rejects.toThrow("该导出由浏览器管理");
    await client.remove(outcome.record.id);

    expect(await client.list()).toEqual([]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  test("ignores invalid browser history and caps valid records at 200", async () => {
    window.localStorage.setItem(
      "liteasy.artifact-export-history.browser.v1",
      JSON.stringify({ records: [{ location: "browser", path: "/fake" }], version: "wrong" })
    );
    const client = createArtifactExportClient({
      createId: (() => {
        let id = 0;
        return () => `browser-record-${id += 1}`;
      })(),
      download: vi.fn(),
      storage: window.localStorage
    });

    expect(await client.list()).toEqual([]);
    for (let index = 0; index < 205; index += 1) {
      await client.export({ ...payload, title: `薄读 ${index}` });
    }

    const records = await client.list();
    expect(records).toHaveLength(200);
    expect(records[0].title).toBe("薄读 204");
    expect(records.at(-1)?.title).toBe("薄读 5");
  });

  test("migrates v1 explicitly and retains opaque future formats as readonly records", async () => {
    const future = { artifactId: "future", exportedAt: "2026-10-12", fileName: "future.bin", format: "future-reader", id: "future", location: "browser", status: "browser_managed", title: "未来文档", opaque: { preserve: true } };
    const legacy = JSON.stringify({ version: "liteasy.artifact-export-history/v1", records: [future] });
    window.localStorage.setItem("liteasy.artifact-export-history.browser.v1", legacy);
    const client = createArtifactExportClient({ download: vi.fn(), storage: window.localStorage });
    expect((await client.list())[0]).toMatchObject({ id: "future", format: "unknown", status: "unsupported", originalFormat: "future-reader" });
    await client.export(payload);
    expect(window.localStorage.getItem("liteasy.artifact-export-history.browser.v1")).toBe(legacy);
    const migrated = JSON.parse(window.localStorage.getItem("liteasy.artifact-export-history.browser.v2")!);
    expect(migrated.version).toBe("liteasy.artifact-export-history/v2");
    expect(migrated.records).toContainEqual(future);
  });

  test("a browser download keeps its honest receipt when history storage fails", async () => {
    const download = vi.fn();
    const client = createArtifactExportClient({ download, storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } });
    const result = await client.export(payload);
    expect(result).toMatchObject({ status: "download_started", warnings: ["history_write_failed"] });
    expect(download).toHaveBeenCalledOnce();
  });
});


test.each([null, {}, [null, { ...desktopRecord, fileName: undefined }, { ...desktopRecord, id: "future", format: "future-format" }]])("projects invalid native export history as preserved read-only rows: %j", async (raw) => {
  const bytes = JSON.stringify(raw);
  const invoke = vi.fn(async () => raw);
  const client = createArtifactExportClient({ invoke });
  const records = await client.list();
  expect(records.length).toBe(Array.isArray(raw) ? raw.length : 1);
  expect(records.every((record) => record.status === "unsupported" && typeof record.fileName === "string")).toBe(true);
  expect(JSON.stringify(raw)).toBe(bytes);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("list_artifact_exports");
});
