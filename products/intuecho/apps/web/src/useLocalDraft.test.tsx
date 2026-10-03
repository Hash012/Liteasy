import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { draftRecords, loadDraft, saveDraft } from "./communityPersistence";
import { useLocalDraft } from "./useLocalDraft";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
function editor(initial = "", initialDraftId?: string) {
  return renderHook(() => {
    const [value, setValue] = useState({ body: initial });
    const draft = useLocalDraft({ owner: "actor", scope: "new", value, onRestore: setValue, initialDraftId });
    return { ...draft, value, edit: (body: string) => setValue({ body }) };
  });
}

test("autosave acknowledges successful persistence only and marks newer edits unsaved", async () => {
  vi.useFakeTimers();
  const view = editor();
  act(() => view.result.current.edit("typed body"));
  expect(view.result.current.status).toContain("尚未保存");
  expect(draftRecords("actor", "new")).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(loadDraft("actor", "new")?.value).toEqual({ body: "typed body" });
  expect(view.result.current.status).toContain("草稿已保存");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  act(() => view.result.current.edit("unsaved body"));
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(view.result.current.status).toContain("草稿尚未保存");
  expect(loadDraft("actor", "new")?.value).toEqual({ body: "typed body" });
});

test("two editor instances fork conflicting revisions instead of overwriting either body", async () => {
  const initial = saveDraft("actor", "new", { body: "base" });
  const first = editor("", initial.draftId); const second = editor("", initial.draftId);
  await waitFor(() => expect(first.result.current.value.body).toBe("base"));
  act(() => first.result.current.edit("first tab"));
  await act(async () => { await first.result.current.save(); });
  act(() => second.result.current.edit("second tab"));
  await act(async () => { await second.result.current.save(); });
  expect(second.result.current.status).toContain("冲突草稿");
  expect(draftRecords("actor", "new").map((draft) => draft.value)).toEqual(expect.arrayContaining([{ body: "first tab" }, { body: "second tab" }]));
});

test("restoring another draft cannot retarget an already queued save", async () => {
  const other = saveDraft("actor", "new", { body: "other original" });
  const view = editor("current content");
  let beforeRestore!: string;
  await act(async () => {
    beforeRestore = view.result.current.draftId;
    const pending = view.result.current.save();
    view.result.current.restore(other.draftId);
    await pending;
  });
  expect(loadDraft("actor", "new", other.draftId)?.value).toEqual({ body: "other original" });
  expect(loadDraft("actor", "new", beforeRestore)?.value).toEqual({ body: "current content" });
  expect(view.result.current.value.body).toBe("other original");
});

test("closing before debounce preserves the last typed bytes as an independent recovery draft", () => {
  const view = editor();
  act(() => view.result.current.edit("last keystroke"));
  view.unmount();
  expect(draftRecords("actor", "new").map((draft) => draft.value)).toContainEqual({ body: "last keystroke" });
});
