import { afterEach, expect, test, vi } from "vitest";
import { persistPdfAnnotationState } from "../app/features/pdf/pdfAnnotationPersistence";
import type { PdfAnnotationPrivateState } from "../app/features/pdf/pdfAnnotationStorage";

const native = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../app/features/library/userPaperArtifactClient", () => ({
  isUserPaperArtifactStoreAvailable: () => true,
  saveUserPaperArtifact: native.save,
}));
const snapshot = (autoPublic: boolean): PdfAnnotationPrivateState => ({ annotations: [], autoPublic, version: 2 });
function save(key: string, autoPublic: boolean) {
  return persistPdfAnnotationState({
    annotationStorageKey: key, autoPublicStorageKey: null, paperId: key, snapshot: snapshot(autoPublic),
  });
}
afterEach(() => {
  native.save.mockReset();
  localStorage.clear();
});

test("successive entry snapshots reach the durable store in order and notify Notes after completion", async () => {
  let finishFirst!: () => void;
  native.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
  native.save.mockResolvedValueOnce(undefined);
  const notesChanged = vi.fn();
  window.addEventListener("liteasy:notes-sources-changed", notesChanged);
  try {
    const first = save("serial-review", false);
    const second = save("serial-review", true);
    await vi.waitFor(() => expect(native.save).toHaveBeenCalledTimes(1));
    expect(notesChanged).not.toHaveBeenCalled();
    finishFirst();
    await Promise.all([first, second]);
    expect(native.save.mock.calls.map(([input]) => input.snapshot.autoPublic)).toEqual([false, true]);
    expect(notesChanged).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("liteasy:notes-sources-changed", notesChanged);
  }
});

test("a failed write is surfaced and a queued review save can still recover", async () => {
  native.save.mockRejectedValueOnce(new Error("disk full"));
  native.save.mockResolvedValueOnce(undefined);
  const first = save("retry-review", false);
  const second = save("retry-review", true);
  await expect(first).rejects.toThrow("disk full");
  await expect(second).resolves.toBeUndefined();
  expect(native.save).toHaveBeenCalledTimes(2);
});
