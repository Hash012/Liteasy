import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import { parseReadingFile } from "../app/features/reading-library/parseReadingFile";
import { readingResourceCapabilities, sourceDocumentBodyCapability } from "../app/features/reading-library/readingResourceCapabilities";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
const entry = (format: ReadingCatalogEntry["format"], extra: Partial<ReadingCatalogEntry> = {}): ReadingCatalogEntry => ({
  id: "fixture", title: "Local field guide", format, available: true, canExport: true, ...extra
});

describe("reading adapter capabilities", () => {
  test.each(["epub", "mobi", "fb2", "html", "markdown", "txt"] as const)("preserves %s reading, body search and extraction without claiming edits or annotations", (format) => {
    const { operations } = readingResourceCapabilities(entry(format));
    for (const name of ["open", "read", "search", "export", "aiExtract"] as const) expect(operations[name]).toMatchObject({ available: true, mode: "body" });
    for (const name of ["edit", "annotate"] as const) expect(operations[name]).toMatchObject({ available: false, reason: expect.any(String) });
  });

  test("separates PDF visual reading and text-layer search from confirmed extracted text", () => {
    const { operations } = readingResourceCapabilities(entry("pdf", { canExport: false }));
    expect(operations.open.available).toBe(true);
    expect(operations.annotate.available).toBe(true);
    expect(operations.search).toEqual({ available: true, mode: "text-layer" });
    expect(operations.aiExtract).toMatchObject({ available: false, reason: expect.stringContaining("尚未提取") });
    expect(operations.export.available).toBe(false);
    expect(readingResourceCapabilities(entry("pdf"), { bodyTextAvailable: true }).operations.aiExtract.available).toBe(true);
  });

  test.each([ ["survey.docx", "office"], ["observations.csv", "csv"], ["config.json", "json"], ["scan.png", "image"], ["archive.bin", "other"] ])("only advertises metadata search and explicit original export for %s", (fileName, format) => {
    const result = readingResourceCapabilities(entry("other", { fileName }));
    expect(result.format).toBe(format);
    expect(result.operations.search).toEqual({ available: true, mode: "metadata" });
    expect(result.operations.export.available).toBe(true);
    for (const name of ["open", "read", "annotate", "edit", "aiExtract"] as const) {
      expect(result.operations[name]).toMatchObject({ available: false, reason: expect.any(String) });
    }
  });

  test("missing source retains metadata search while export requires a real adapter", () => {
    const { operations } = readingResourceCapabilities(entry("pdf", { available: false }));
    expect(operations.search).toEqual({ available: true, mode: "metadata" });
    for (const name of ["open", "read", "annotate", "edit", "export", "aiExtract"] as const) expect(operations[name].available).toBe(false);
    expect(readingResourceCapabilities(entry("epub", { canExport: undefined })).operations.export.available).toBe(false);
    expect(readingResourceCapabilities(entry("epub", { canExport: false }), { canExport: true }).operations.export.available).toBe(false);
    expect(readingResourceCapabilities(entry("epub"), { canExport: false }).operations.export.available).toBe(false);
    expect(readingResourceCapabilities(entry("epub"), { bodyTextAvailable: false }).operations.aiExtract.available).toBe(false);
  });

  test("uses actual imported source MIME and body, excluding legacy unparsed placeholders", async () => {
    const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope);
    const objects = createObjectRepository(storage, scope), library = createReadingLibraryRepository(storage, scope);
    const htmlBytes = new TextEncoder().encode("<h1>Field guide</h1><p>Local specimen text.</p>");
    const parsed = await parseReadingFile({ name: "guide.html", bytes: htmlBytes });
    const readable = await library.importFile("guide.html", htmlBytes, parsed);
    const saved = await library.importFile("data.json", new TextEncoder().encode('{"sample":1}'), {
      format: "other", title: "Field data", authors: [], chapters: [], toc: [], resources: [], warnings: []
    });
    const body = await objects.get(readable.entry.ref), placeholder = await objects.get(saved.entry.ref);
    expect(sourceDocumentBodyCapability(body)).toEqual({ available: true, mode: "body" });
    expect(sourceDocumentBodyCapability(placeholder)).toMatchObject({ available: false, reason: expect.stringContaining("尚未提取正文") });
    if (body.kind !== "source.document") throw new Error("source fixture missing");
    expect(sourceDocumentBodyCapability({ ...body, content: { ...body.content, payload: { ...body.content.payload, text: " " } } }).available).toBe(false);
    expect(sourceDocumentBodyCapability({ ...body, content: { ...body.content, payload: { ...body.content.payload, availability: "unavailable" } } }).available).toBe(false);
    expect(sourceDocumentBodyCapability({ ...body, content: { ...body.content, payload: {
      ...body.content.payload, legacyKey: `paper-context-metadata:${body.content.payload.paperId}`
    } } }).available).toBe(false);
  });
});
