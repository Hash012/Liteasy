import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import { saveUserPaperArtifact, subscribePaperFulltextSaved } from "../app/features/library/userPaperArtifactClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockReset();
});

test("only successful native fulltext writes notify project subscribers", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: { invoke: vi.fn() } });
  const listener = vi.fn();
  const unsubscribe = subscribePaperFulltextSaved(listener);
  vi.mocked(invoke).mockResolvedValue(undefined);
  await saveUserPaperArtifact({ artifactKind: "annotations", paperId: "paper-a", snapshot: {} });
  expect(listener).not.toHaveBeenCalled();
  await saveUserPaperArtifact({ artifactKind: "fulltext", paperId: "paper-a", snapshot: { pages: [] } });
  expect(listener).toHaveBeenCalledExactlyOnceWith("paper-a");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  await expect(saveUserPaperArtifact({ artifactKind: "fulltext", paperId: "paper-b", snapshot: {} })).rejects.toThrow("disk full");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  await saveUserPaperArtifact({ artifactKind: "fulltext", paperId: "paper-c", snapshot: {} });
  expect(listener).toHaveBeenCalledTimes(1);
});
