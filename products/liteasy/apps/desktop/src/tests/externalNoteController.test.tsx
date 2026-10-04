import "fake-indexeddb/auto";
import { createNotesRepository } from "../app/features/notes/notesRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useExternalNoteController } from "../app/controllers/useExternalNoteController";
import type { NoteFileSnapshot } from "../app/features/note-files/noteFileService";

const gateway = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../app/features/note-files/noteFileService", () => ({ createNoteFileService: gateway.create }));
afterEach(() => vi.clearAllMocks());
const note = (name: string): NoteFileSnapshot => ({ mountId: "vault", path: name, name, kind: "file", text: `# ${name}`, version: "v1" });

test("keeps only unsaved inactive drafts and saves them with their original disk version", async () => {
  const first = note("a.md"); const second = note("b.md");
  const writeFile = vi.fn(async (input) => ({ ...first, ...input, version: "v2" }));
  gateway.create.mockReturnValue({ readFile: vi.fn(async (_id, path) => path === "a.md" ? first : second), writeFile });
  const { result } = renderHook(() => useExternalNoteController({ scopeId: "scope", visible: false, onOpen: () => {} }));
  act(() => result.current.open(first));
  act(() => result.current.setDraft("unsaved A"));
  act(() => result.current.open(second));
  expect(result.current.drafts.map((file) => file.name)).toEqual(["a.md"]);
  act(() => result.current.open(first));
  expect(result.current.session?.draft).toBe("unsaved A");
  expect(result.current.drafts).toEqual([]);
  await act(async () => result.current.save());
  expect(writeFile).toHaveBeenCalledWith({ mountId: "vault", path: "a.md", text: "unsaved A", expectedVersion: "v1" });
  expect(result.current.session?.snapshot.text).toBe("unsaved A");
  await waitFor(async () => {
    const labels = await createNotesRepository(createObjectStorage("scope", () => "scope")).listLabels();
    expect(labels.get("external-file:vault:a.md")).toEqual({ "user-edited": true });
  });
});

test("a poll started before saving cannot roll a successful save back to stale content", async () => {
  const first = note("a.md");
  let finish!: (file: NoteFileSnapshot) => void;
  const readFile = vi.fn(() => new Promise<NoteFileSnapshot>((resolve) => { finish = resolve; }));
  gateway.create.mockReturnValue({ readFile, writeFile: async (input: { text: string }) => ({ ...first, text: input.text, version: "v2" }) });
  const { result } = renderHook(() => useExternalNoteController({ scopeId: "scope", visible: true, onOpen: () => {} }));
  act(() => result.current.open(first));
  await waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));
  act(() => result.current.setDraft("just saved"));
  await act(async () => result.current.save());
  await act(async () => finish(first));
  expect(result.current.session).toMatchObject({ draft: "just saved", snapshot: { version: "v2", text: "just saved" } });
});

test("a failed disk write preserves editable drafts and allows a create-only copy", async () => {
  const first = note("a.md");
  const writeFile = vi.fn().mockRejectedValueOnce(new Error("文件已在其他应用中修改")).mockImplementationOnce(async (input) => ({ ...first, ...input, version: "copy" }));
  gateway.create.mockReturnValue({ writeFile });
  const { result } = renderHook(() => useExternalNoteController({ scopeId: "scope", visible: false, onOpen: () => {} }));
  act(() => result.current.open(first)); act(() => result.current.setDraft("mine"));
  await act(async () => result.current.save());
  expect(result.current.error).toContain("其他应用"); expect(result.current.session?.draft).toBe("mine");
  act(() => result.current.setDraft("continued editing"));
  await act(async () => result.current.save(true));
  expect(writeFile.mock.calls[1][0]).toMatchObject({ text: "continued editing", expectedVersion: null });
  expect(writeFile.mock.calls[1][0].path).not.toBe("a.md");
});

test("autosave serializes writes and retains text typed while a disk write is pending", async () => {
  vi.useFakeTimers();
  try {
    const first = note("a.md");
    let finish!: (value: NoteFileSnapshot) => void;
    const writeFile = vi.fn().mockImplementationOnce(() => new Promise<NoteFileSnapshot>((resolve) => { finish = resolve; }))
      .mockImplementation(async (input) => ({ ...first, text: input.text, version: "v3" }));
    gateway.create.mockReturnValue({ writeFile });
    const { result, unmount } = renderHook(() => useExternalNoteController({ scopeId: "scope", visible: false, autosave: true, onOpen: () => {} }));
    act(() => result.current.open(first)); act(() => result.current.setDraft("first edit"));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(writeFile).toHaveBeenCalledTimes(1);
    act(() => result.current.setDraft("second edit"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(writeFile).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ...first, text: "first edit", version: "v2" }); });
    expect(result.current.session?.draft).toBe("second edit");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(writeFile.mock.calls[1][0]).toMatchObject({ expectedVersion: "v2", text: "second edit" });
    unmount();
  } finally { vi.useRealTimers(); }
});

test("autosave pauses after a conflict, including further typing, and cancels pending work on file switch", async () => {
  vi.useFakeTimers();
  try {
    const first = note("a.md"), second = note("b.md");
    const writeFile = vi.fn().mockRejectedValue(new Error("文件已在其他应用中修改"));
    gateway.create.mockReturnValue({ writeFile });
    const { result, unmount } = renderHook(() => useExternalNoteController({ scopeId: "scope", visible: false, autosave: true, onOpen: () => {} }));
    act(() => result.current.open(first)); act(() => result.current.setDraft("mine"));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.error).toContain("其他应用");
    act(() => result.current.setDraft("continued"));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(writeFile).toHaveBeenCalledTimes(1);
    act(() => result.current.open(second)); act(() => result.current.setDraft("second draft"));
    act(() => result.current.open(first));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(writeFile.mock.calls.every(([input]) => input.path === "a.md")).toBe(true);
    expect(result.current.drafts).toHaveLength(1);
    unmount();
  } finally { vi.useRealTimers(); }
});

test("autosave waits until IME composition ends and does not write when manual mode disables it", async () => {
  vi.useFakeTimers();
  try {
    const first = note("a.md");
    const writeFile = vi.fn(async (input) => ({ ...first, text: input.text, version: "v2" }));
    gateway.create.mockReturnValue({ writeFile });
    const { result, rerender, unmount } = renderHook(({ enabled }) => useExternalNoteController({ scopeId: "scope", visible: false, autosave: enabled, onOpen: () => {} }), { initialProps: { enabled: true } });
    act(() => result.current.open(first));
    act(() => { document.dispatchEvent(new CompositionEvent("compositionstart")); result.current.setDraft("拼"); });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(writeFile).not.toHaveBeenCalled();
    act(() => { result.current.setDraft("拼音输入完成"); document.dispatchEvent(new CompositionEvent("compositionend")); });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ text: "拼音输入完成" }));
    rerender({ enabled: false });
    act(() => result.current.setDraft("manual draft"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(writeFile).toHaveBeenCalledTimes(1);
    unmount();
  } finally { vi.useRealTimers(); }
});
