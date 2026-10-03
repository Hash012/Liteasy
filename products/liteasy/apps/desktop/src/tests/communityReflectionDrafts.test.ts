import { beforeEach, expect, test, vi } from "vitest";
import { createReflectionDraft, reflectionDrafts, removeReflectionDraft, writeReflectionDraft } from "../app/features/forum/communityReflectionDrafts";
import type { CommunitySourceReference } from "../app/features/forum/communitySourceReference";

const source: CommunitySourceReference = { sourceNamespace: "intuecho.annotation", sourceId: "source", revision: 2 };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

test("two windows fork a recovered reflection without overwriting the other version or changing its citation", () => {
  const original = writeReflectionDraft(createReflectionDraft("actor-a", source, "first"), "First thought", "first");
  const a = writeReflectionDraft(original, "Window A", "window-a");
  const b = writeReflectionDraft(original, "Window B", "window-b");
  expect(new Set([original.id, a.id, b.id]).size).toBe(3);
  expect(reflectionDrafts("actor-a", { ...source, revision: 3 }).map((draft) => draft.text).sort()).toEqual(["First thought", "Window A", "Window B"]);
  expect(reflectionDrafts("actor-b", source)).toEqual([]);
  expect(a.reference.revision).toBe(2);
  const updated = writeReflectionDraft(a, "Window A revised", "window-a");
  expect(removeReflectionDraft(a)).toBe(false);
  expect(removeReflectionDraft(b)).toBe(true);
  expect(reflectionDrafts("actor-a", source)).toContainEqual(updated);
});

test("a corrupted draft stays intact while healthy drafts remain readable", () => {
  const draft = writeReflectionDraft(createReflectionDraft("actor", source, "writer"), "Original", "writer");
  const key = localStorage.key(0)!;
  localStorage.setItem(key, "{broken");
  const fork = writeReflectionDraft(draft, "Recovered from editor", "writer");
  expect(localStorage.getItem(key)).toBe("{broken");
  expect(fork.id).not.toBe(draft.id);
  expect(reflectionDrafts("actor", source)).toEqual([fork]);
});

test("storage quota failures never acknowledge saved reflection text", () => {
  const draft = createReflectionDraft("actor", source, "writer");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  expect(() => writeReflectionDraft(draft, "Keep this in the editor", "writer")).toThrow("想法尚未保存");
  expect(reflectionDrafts("actor", source)).toEqual([]);
});
