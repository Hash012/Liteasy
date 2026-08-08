import { sanitizeExternalPdfFileName } from "../app/features/library/externalPdfDownload";
import {
  cacheExternalPdf,
  clearPaperCache,
  promoteCachedPdfToLibrary,
  readCachedPdf
} from "../app/features/library/paperCacheClient";

type RecordedCall = { args?: Record<string, unknown>; command: string };

function recordingInvoke<T>(result: T) {
  const calls: RecordedCall[] = [];
  const invoke = async <R,>(command: string, args?: Record<string, unknown>): Promise<R> => {
    calls.push({ args, command });
    return result as unknown as R;
  };
  return { calls, invoke };
}

test("caches an external PDF under its content fingerprint", async () => {
  const cachePath = "C:/cache/paper-cache/abc.pdf";
  const { calls, invoke } = recordingInvoke(cachePath);

  const stored = await cacheExternalPdf({
    bytes: new Uint8Array([37, 80, 68, 70, 45, 49]),
    contentHash: "a".repeat(64),
    invoke
  });

  expect(stored).toBe(cachePath);
  expect(calls).toHaveLength(1);
  expect(calls[0].command).toBe("cache_external_pdf");
  // Tauri maps camelCase arguments onto the Rust command's snake_case parameters.
  expect(calls[0].args).toEqual({
    bytes: [37, 80, 68, 70, 45, 49],
    contentHash: "a".repeat(64)
  });
});

test("reads a cached PDF back as bytes", async () => {
  const { calls, invoke } = recordingInvoke([37, 80, 68, 70, 45]);

  const bytes = await readCachedPdf({ cachePath: "C:/cache/paper-cache/abc.pdf", invoke });

  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(Array.from(bytes)).toEqual([37, 80, 68, 70, 45]);
  expect(calls[0]).toEqual({
    args: { cachePath: "C:/cache/paper-cache/abc.pdf" },
    command: "read_cached_pdf"
  });
});

test("promotes a cached paper into the library and reports its new path", async () => {
  const libraryPath = "C:/library/papers/Attention is all you need.pdf";
  const { calls, invoke } = recordingInvoke(libraryPath);

  const promoted = await promoteCachedPdfToLibrary({
    cachePath: "C:/cache/paper-cache/abc.pdf",
    fileName: "Attention is all you need.pdf",
    invoke
  });

  expect(promoted).toBe(libraryPath);
  expect(calls[0]).toEqual({
    args: {
      cachePath: "C:/cache/paper-cache/abc.pdf",
      fileName: "Attention is all you need.pdf"
    },
    command: "promote_cached_pdf_to_library"
  });
});

test("reports what clearing the cache freed", async () => {
  const { calls, invoke } = recordingInvoke({ byteLength: 2048, fileCount: 2 });

  const removed = await clearPaperCache({ invoke });

  expect(removed).toEqual({ byteLength: 2048, fileCount: 2 });
  expect(calls[0].command).toBe("clear_paper_cache");
});

test("keeps promoted file names writable on Windows", () => {
  expect(sanitizeExternalPdfFileName("A/B: study? <draft>")).toBe("A B study draft.pdf");
  expect(sanitizeExternalPdfFileName("   ")).toBe("Untitled paper.pdf");
  expect(sanitizeExternalPdfFileName("already named.PDF")).toBe("already named.PDF");
});

test("refuses to reach the cache when the desktop bridge is absent", async () => {
  await expect(
    cacheExternalPdf({ bytes: new Uint8Array([37]), contentHash: "b".repeat(64) })
  ).rejects.toThrow("当前环境没有本地论文缓存");
});
