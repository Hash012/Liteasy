import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useWorkbenchStartController } from "../app/controllers/useWorkbenchStartController";
import type { NoteFileService, NoteFileSnapshot } from "../app/features/note-files/noteFileService";
import type { DockRegionId } from "../app/features/dock/dock.types";

const original = { collapsed: { left: false, right: true, bottom: false }, hiddenRegions: ["bar-hidden"] as DockRegionId[] };
const regions: DockRegionId[] = ["main", "left", "right", "bottom", "bar-1", "bar-hidden"];
function fixture(files: NoteFileService) {
  const open = vi.fn(); const openNote = vi.fn();
  const hook = renderHook(({ scopeId }) => {
    const [visibility, restoreVisibility] = useState(original);
    return { visibility, ...useWorkbenchStartController({ scopeId, files, regionIds: regions, visibility, restoreVisibility, open, openNote }) };
  }, { initialProps: { scopeId: "local" } });
  return { ...hook, open, openNote };
}

test("presets only change visibility and restore a custom six-pane layout", () => {
  const hook = fixture({} as NoteFileService);
  act(() => hook.result.current.applyPreset("reading"));
  expect(hook.result.current.visibility).toEqual({ collapsed: { left: true, right: true, bottom: true }, hiddenRegions: regions.filter(id => id !== "main") });
  act(() => hook.result.current.applyPreset("processing"));
  expect(hook.open.mock.calls.map(call => call[0])).toEqual(["library", "assistant", "workflow-runs"]);
  act(() => hook.result.current.applyPreset("research"));
  expect(hook.result.current.visibility.collapsed.bottom).toBe(true);
  act(() => hook.result.current.applyPreset("custom"));
  expect(hook.result.current.visibility).toEqual(original);
  expect(regions).toHaveLength(6);
});

test("opens the chosen original Markdown through the existing reader without writing or importing it", async () => {
  const file = { mountId: "selected-file", path: "中文 note.md", name: "中文 note.md", text: "# Original", version: "hash-original" } as NoteFileSnapshot;
  const chooseFile = vi.fn(async () => file); const writeFile = vi.fn(); const pickFiles = vi.fn();
  const hook = fixture({ chooseFile, writeFile, pickFiles } as unknown as NoteFileService);
  await act(() => hook.result.current.openNote());
  expect(chooseFile).toHaveBeenCalledWith({ extension: "md", mode: "open" });
  expect(hook.openNote).toHaveBeenCalledWith(file);
  expect(writeFile).not.toHaveBeenCalled(); expect(pickFiles).not.toHaveBeenCalled();
});

test("cancelled picker leaves the workspace alone and errors remain visible", async () => {
  const chooseFile = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("原文件不可读"));
  const hook = fixture({ chooseFile } as unknown as NoteFileService);
  await act(() => hook.result.current.openNote());
  expect(hook.openNote).not.toHaveBeenCalled();
  await act(() => hook.result.current.openNote());
  expect(hook.result.current.notice).toBe("原文件不可读");
});

test("an account switch while the picker is open cannot attach another account's file", async () => {
  let resolve!: (file: NoteFileSnapshot) => void;
  const chooseFile = vi.fn(() => new Promise<NoteFileSnapshot>(done => { resolve = done; }));
  const hook = fixture({ chooseFile } as unknown as NoteFileService);
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.openNote(); });
  expect(hook.result.current.availability["open-note"]).toContain("正在选择");
  hook.rerender({ scopeId: "user:other" });
  await act(async () => { resolve({ mountId: "private", path: "private.md" } as NoteFileSnapshot); await pending; });
  expect(hook.openNote).not.toHaveBeenCalled();
});
